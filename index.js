import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { mdns } from '@libp2p/mdns'
import { Key } from 'interface-datastore'
import { LevelBlockstore } from 'blockstore-level'
import { LevelDatastore } from 'datastore-level'
import { mplex } from '@libp2p/mplex'
import { identify } from '@libp2p/identify'
import { createEd25519PeerId, exportToProtobuf,  createFromProtobuf } from '@libp2p/peer-id-factory'
import { autoNAT } from '@libp2p/autonat'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { webSockets } from '@libp2p/websockets'
import { webTransport } from '@libp2p/webtransport'
import { webRTC } from '@libp2p/webrtc'
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
                     '/webrtc'	
            ]
        },
        transports: [
            tcp(),
            webSockets({
                filter: filters.all
            }),
            webRTC({
                rtcConfiguration: {
	        iceServers:[{
         	 	urls: [
            			'stun:stun.l.google.com:19302',
            			'stun:global.stun.twilio.com:3478'
          		]
        	  }]
    		}
	    }),
	    webTransport()
        ],
        connectionEncryption: [noise()],
        streamMuxers: [yamux()],
        services: {
            identify: identify(),
            autoNAT: autoNAT(),
            pubsub: gossipsub({ allowPublishToZeroPeers: true }),
            dht: kadDHT({
                kBucketSize: 20,
                clientMode: false,
                enabled: true,
                randomWalk: {
                    enabled: true,            // Allows to disable discovery (enabled by default)
                    interval: 300e3,
                    timeout: 10e3
                }
            })
        }
    }

    //libp2p	
    const libp2p = await createLibp2p(Libp2pOptions)

    libp2p.addEventListener('peer:discovery', (evt) => {
        //console.log('Discovered %s', evt.detail.id.toString()) // Log discovered peer
    })

    libp2p.addEventListener('peer:connect', (evt) => {
        //console.log('Connected to %s', evt.detail.toString()) // Log connected peer
    })

    //helia
    const blockstore = new LevelBlockstore('./data/ipfs')
    const ipfs = await createHelia({ libp2p: libp2p, blockstore: blockstore, datastore: leveldatastore })   
    const fs = unixfs(ipfs)

    
    //orbit db    
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

    //Replication event
    db.events.on('update', async (entry) => {
        // what has been updated.
        let record = entry.payload.value
        console.log('db updated:',  record)
        let cid = record.cid
        const decoder = new TextDecoder()
	let text = ''
        // use Helia node to fetch the file from the remote Helia node
	for await (const chunk of fs.cat(cid)) {
  			text += decoder.decode(chunk, {
			stream: true
		})
	}

	console.log('Fetched file contents:', text)
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
    
       
    //Put some file to IPFS
    const encoder = new TextEncoder() //
    const bytes = encoder.encode(randomText)
    // add the bytes to your node and receive a unique content identifier
    const cid = await fs.addBytes(bytes) //TODO: bytes will be uploaded directly over REST API
    console.log('Added file to IPFS:', cid.toString())  
    
    //Put our object to Orbit to key/value database. For this demo we use peerId as key.
    //Object will contain some random text property and cid of uploaded file.
    //Remote peer will retreive the file from IPFS on db replication event
    await db.put(libp2p.peerId.toString(), { peer: libp2p.peerId.toString(), text: randomText, cid: cid})
 
}

main()
