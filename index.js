import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { tcp } from '@libp2p/tcp'
import { mdns } from '@libp2p/mdns'
import { identify } from '@libp2p/identify'
import { LevelBlockstore } from 'blockstore-level'
import { mplex } from '@libp2p/mplex'
import { createLibp2p } from 'libp2p'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { webSockets } from '@libp2p/websockets'
import { bootstrap } from '@libp2p/bootstrap'
import { kadDHT, removePrivateAddressesMapper } from '@libp2p/kad-dht'
import { peerIdFromString } from '@libp2p/peer-id'
import * as filters from '@libp2p/websockets/filters'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { createOrbitDB, IPFSAccessController } from '@orbitdb/core'
import { createHelia } from 'helia'

const main = async () => {  

    // Known peers addresses
    const bootstrapMultiaddrs = ['/ip4/172.18.142.112/tcp/3303/p2p/12D3KooWHmzmcAx5UxC8ur8yBVEsh6LrMgeNvqhYcjRbGHaRMNzH',
    ]
    const Libp2pOptions = {
        peerDiscovery: [
            mdns(),
            bootstrap({
                list: bootstrapMultiaddrs, // provide array of multiaddrs
            })
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
            pubsub: gossipsub({ allowPublishToZeroPeers: true }),
            dht: kadDHT({
                kBucketSize: 20,
                clientMode: false,
            })
        }
    }

    const libp2p = await createLibp2p(Libp2pOptions)

    libp2p.addEventListener('peer:discovery', (evt) => {
        console.log('Discovered %s', evt.detail.id.toString()) // Log discovered peer
    })

    libp2p.addEventListener('peer:connect', (evt) => {
        console.log('Connected to %s', evt.detail.toString()) // Log connected peer
    })

    const blockstore = new LevelBlockstore('./ipfs')

    const ipfs = await createHelia({ libp2p, blockstore })

    const orbitdb = await createOrbitDB({ ipfs, directory: './ipfs/orbitdb' })

    let db

    if (process.argv[2]) {
        db = await orbitdb.open(process.argv[2])

    } else {
        // When we open a new database, write access is only available to the
        // db creator. If we want to allow other peers to write to the database,
        // they must be specified in IPFSAccessController write array param. Here,
        // we simply allow anyone to write to the database. A more robust solution
        // would use the OrbitDBAccessController to provide mutable, "fine-grain"
        // access using grant and revoke.
        db = await orbitdb.open('my-db', { AccessController: IPFSAccessController({ write: ['*']}) })

        // Copy this output if you want to connect a peer to another.
        console.log('my-db address', '(copy my db address and use when launching peer 2)', db.address)
        console.log('my-db peer address', libp2p.getMultiaddrs().toString());
    }

    db.events.on('update', async (entry) => {
        // what has been updated.
        console.log('update', entry.payload.value)
    })

    if (process.argv[2]) {
        //await db.add('hello from second peer')
        //await db.add('hello again from second peer')
    } else {
        // write some records
        //await db.add('hello from first peer')
        //await db.add('hello again from first peer')
    }
    // Clean up when stopping this app using ctrl+c
    process.on('SIGINT', async () => {
        // print the final state of the db.
        console.log((await db.all()).map(e => e.value))
        // Close your db and stop OrbitDB and IPFS.
        ipfs.blockstore.child.child.close()
        await db.close()
        await orbitdb.stop()
        await ipfs.stop()

        process.exit()
    })
   console.log('Peer Id:', libp2p.peerId.toString());

}

main()
