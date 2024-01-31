# OrbitDB example
Demonstrating data replication between Helia nodes using the OrbitDB key-value database. Utilizing bootstrap for peer discovery, it is essential for at least one "seeding" node to run first, creating the database and printing out its PeerId. 

### Prerequisites
- Node.js - [Download & Install Node.js](https://nodejs.org/en/download/) and the npm package manager.

## Installation and Running 
On the "seeding" node run

```console
> npm i
> node ./index.js

Generated peerId:12D3KooWFcQahJpVawm8mTrmziPtu34xBWr45qCucZXGJobbSR6t
db address: /orbitdb/zdpuAxkqWUpn77JWtut2iToH7ENy2C7h7uirwySYW4Z1q1e1h
Peer Id: 12D3KooWFcQahJpVawm8mTrmziPtu34xBWr45qCucZXGJobbSR6t
Peer address: /ip4/127.0.0.1/tcp/3303/p2p/12D3KooWFcQahJpVawm8mTrmziPtu34xBWr45qCucZXGJobbSR6t,/ip4/172.18.142.112/tcp/3303/p2p/12D3KooWFcQahJpVawm8mTrmziPtu34xBWr45qCucZXGJobbSR6t,/ip4/127.0.0.1/tcp/3304/ws/p2p/12D3KooWFcQahJpVawm8mTrmziPtu34xBWr45qCucZXGJobbSR6t,/ip4/172.18.142.112/tcp/3304/ws/p2p/12D3KooWFcQahJpVawm8mTrmziPtu34xBWr45qCucZXGJobbSR6t
Added file to IPFS: bafkreigt5s6r3cv6dzvbqvgzv5qadg7m55enlfrglqbgzk3gdgzonem6om
```

On secondary nodes (on other machines in different networks), after installing dependencies with 'npm i', launch the service using the 'db address' parameter displayed on the seeding node:

```console
> npm i
> node index.js /orbitdb/zdpuAxkqWUpn77JWtut2iToH7ENy2C7h7uirwySYW4Z1q1e1h
Reused peerId:12D3KooWFiiS6d91xgUJqryaiZZ5j8ty3i64MGSADf9MfesJiYqU
Peer Id: 12D3KooWFiiS6d91xgUJqryaiZZ5j8ty3i64MGSADf9MfesJiYqU
Peer address: /ip4/127.0.0.1/tcp/3303/p2p/12D3KooWFiiS6d91xgUJqryaiZZ5j8ty3i64MGSADf9MfesJiYqU,/ip4/172.20.64.111/tcp/3303/p2p/12D3KooWFiiS6d91xgUJqryaiZZ5j8ty3i64MGSADf9MfesJiYqU,/ip4/127.0.0.1/tcp/3304/ws/p2p/12D3KooWFiiS6d91xgUJqryaiZZ5j8ty3i64MGSADf9MfesJiYqU,/ip4/172.20.64.111/tcp/3304/ws/p2p/12D3KooWFiiS6d91xgUJqryaiZZ5j8ty3i64MGSADf9MfesJiYqU
Added file to IPFS: bafkreiecbue6u4d5ohggj46fmw2qe7jzg234syvnva7xsp2yhbwps4zkt4
```
If replication (resulting in the printing out of objects added to the database by connected peers) hasn't already occurred, then add the seeding peer's address (the one with a public IPv4 address) to the 'config/bootstrappers.js' list of the secondary node.


## Replication
When the node starts, it adds an object with some random data to the database. PeerId is used as the key (which could be any meaningful or calculated value). Additionally, for demonstration purposes, a random text file is added to the IPFS block store. Its CID is then passed to the remote peers as the 'cid' property of the object. Upon receiving an 'update' (replication) event, remote peers print out the object and retrieve the file from IPFS.

