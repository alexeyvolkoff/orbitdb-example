import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { mdns } from '@libp2p/mdns'
import { Key } from 'interface-datastore'
import { FsBlockstore } from 'blockstore-fs'
import { LevelDatastore } from 'datastore-level'
import { mplex } from '@libp2p/mplex'
import { identify } from '@libp2p/identify'
import { peerIdFromString } from '@libp2p/peer-id'
import { createEd25519PeerId, exportToProtobuf,  createFromProtobuf } from '@libp2p/peer-id-factory'
import { autoNAT } from '@libp2p/autonat'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { webSockets } from '@libp2p/websockets'
import { bootstrap } from '@libp2p/bootstrap'
import { kadDHT, removePrivateAddressesMapper } from '@libp2p/kad-dht'
import * as filters from '@libp2p/websockets/filters'
import { createOrbitDB, IPFSAccessController } from '@orbitdb/core'
import { createHelia } from 'helia'
import { unixfs } from '@helia/unixfs'
import { EventEmitter } from 'events';
import bootstrappers from './config/bootstrappers.js'


const main = async () => {  


    EventEmitter.defaultMaxListeners = 200;
    //Reusable peerId
    let peerId
    const leveldatastore = new LevelDatastore('./data/settings')
    await leveldatastore.open();
    const exists =  await leveldatastore.has(new Key('/peerId'))
    if (! exists) {
	peerId = await createEd25519PeerId()
	let peerData = exportToProtobuf(peerId)
	await leveldatastore.put( new Key('/peerId'), peerData)
        console.log('Generated new peerId:' + peerId.toString())
    } else {
        let peerData = await leveldatastore.get(new Key('/peerId'))
	peerId = await createFromProtobuf(peerData)
        console.log('Reused peerId:' + peerId.toString())
    }	
	
	
    //Libp2p config	
    const Libp2pOptions = {
        datastore: leveldatastore,
        peerId: peerId,
        peerDiscovery: [
            bootstrap({
                list: bootstrappers, // provide array of multiaddrs
            }),
            pubsubPeerDiscovery(),
            mdns()
        ],
        addresses: {
            listen: ['/ip4/0.0.0.0/tcp/3303',
                     '/ip4/0.0.0.0/tcp/3304/ws',
            ]
        },
        transports: [
            tcp(),
            webSockets({
                filter: filters.all
            }),
        ],
        connectionEncryption: [noise()],
        streamMuxers: [yamux()],
        services: {
            identify: identify(),
            autoNAT: autoNAT(),
            pubsub: gossipsub({ allowPublishToZeroPeers: true }),
            dht: kadDHT({
                kBucketSize: 20,
                clientMode: true,
                enabled: true,
                randomWalk: {
                    enabled: true,            // Allows to disable discovery (enabled by default)
                    interval: 300e3,
                    timeout: 10e3
                }
            })
        }
    }
    process.setMaxListeners(200)

    const libp2p = await createLibp2p(Libp2pOptions)

    libp2p.addEventListener('peer:discovery', (evt) => {
        //console.log('Discovered %s', evt.detail.id.toString()) // Log discovered peer
    })

    libp2p.addEventListener('peer:connect', (evt) => {
        //console.log('Connected to %s', evt.detail.toString()) // Log connected peer
    })

    const blockstore = new FsBlockstore('./data/ipfs')
    const ipfs = await createHelia({ libp2p: libp2p, blockstore: blockstore, datastore: leveldatastore })   
    const fs = unixfs(ipfs)    
    const orbitdb = await createOrbitDB({ ipfs, directory: './data/orbitdb' })
    let db

    if (process.argv[2]) {
        db = await orbitdb.open(process.argv[2], { type: 'keyvalue' } )

    } else {
        // When we open a new database, write access is only available to the
        // db creator. If we want to allow other peers to write to the database,
        // they must be specified in IPFSAccessController write array param. Here,
        // we simply allow anyone to write to the database. A more robust solution
        // would use the OrbitDBAccessController to provide mutable, "fine-grain"
        // access using grant and revoke.
        db = await orbitdb.open('onmydisk', { type: 'keyvalue', AccessController: IPFSAccessController({ write: ['*']}) })

        // Copy this output if you want to connect a peer to another.
        console.log('db address:',  db.address)
    }

    db.events.on('update', async (entry) => {
        // what has been updated.
        console.log('db updated:',  entry.payload.value)
    })

    // Clean up when stopping this app using ctrl+c
    process.on('SIGINT', async () => {
        // print the final state of the db.
        console.log((await db.all()).map(e => e.value))
        // Close your db and stop OrbitDB and IPFS.
        await db.close()
        await orbitdb.stop()
        await ipfs.stop()

        process.exit()
    })
    
    //Add some random text file to IPFS
    let randomText = 'Text Message:' + (Math.random() + 1).toString(36).substring(2)

    console.log('Peer Id:', libp2p.peerId.toString());
    console.log('Peer address:', libp2p.getMultiaddrs().toString());
    
    
    //Put some object to Orbit
    await db.put(libp2p.peerId.toString(), { peer: libp2p.peerId.toString(), text: randomText})
    
    //Put some file to IPFS
    const encoder = new TextEncoder() //
    const bytes = encoder.encode(randomText)

    // add the bytes to your node and receive a unique content identifier
    const cid = await fs.addBytes(bytes) //bytes could be uploaded directly over REST API
    console.log('Added file to IPFS:', cid.toString())   
}

main()
