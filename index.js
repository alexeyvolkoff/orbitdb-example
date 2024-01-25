import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { mplex } from '@libp2p/mplex'
import { webSockets } from '@libp2p/websockets'
import { webRTC } from '@libp2p/webrtc'
import * as filters  from '@libp2p/websockets/filters'
import { createLibp2p } from 'libp2p'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { createOrbitDB, IPFSAccessController } from '@orbitdb/core'
import { createHelia } from 'helia'

const main = async () => {  
    const Libp2pOptions = {
        addresses: {
            listen: ['/ip4/127.0.0.1/tcp/0/ws']
        },
        transports: [
            webSockets({
                filter: filters.all
            })
        ],
        connectionEncryption: [noise()],
        streamMuxers: [yamux(), mplex()],
        services: {
            identify: identify(),
            relay: circuitRelayServer({
                reservations: {
                    maxReservations: Infinity
                }
            }),
            pubsub: gossipsub({ allowPublishToZeroPeers: true })
        },
        connectionManager: {
            minConnections: 0
        }
    }

    const libp2p = await createLibp2p(Libp2pOptions)
    const ipfs = await createHelia({ libp2p })

    // create a random directory to avoid OrbitDB conflicts.
    let randDir = (Math.random() + 1).toString(36).substring(2)

    const orbitdb = await createOrbitDB({ ipfs, directory: `./${randDir}/orbitdb` })

    let db

    if (process.argv[2]) {
        db = await orbitdb.open(process.argv[2])
    } else {
        // When we open a new database, write access is only available to the
        // db creator. When replicating a database on a remote peer, the remote
        // peer must also have write access. Here, we are simply allowing anyone
        // to write to the database. A more robust solution would use the
        // OrbitDBAccessController to provide "fine-grain" access using grant and
        // revoke.
        db = await orbitdb.open('my-db', { AccessController: IPFSAccessController({ write: ['*']})})
    }

  // Copy this output if you want to connect a peer to another.
  console.log('my-db address', db.address)

  // Add some records to the db when another peers joins.
  db.events.on('join', async (peerId, heads) => {
    await db.add('hello world 1')
    await db.add('hello world 2')
  })

  db.events.on('update', async (entry) => {
    console.log('entry', entry)
    
    // To complete full replication, fetch all the records from the other peer.
    await db.all()
  })

  // Clean up when stopping this app using ctrl+c
  process.on('SIGINT', async () => {
      // Close your db and stop OrbitDB and IPFS.
      await db.close()
      await orbitdb.stop()
      await ipfs.stop()

      process.exit()
  })
}

main()
