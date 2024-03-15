import { exit } from "process"
import { config } from "./config"
import { createSocket } from "dgram";
import { EventEmitter } from "stream";
import { Proxy } from "~/type"

// 测试多个链接，多发包
// 测试多个链接，多发包
let proxy: Proxy | undefined

for (const one of config.proxies) {
    if (one.type == "udp") {
        proxy = one
        break
    }
}

if (proxy == null) {
    exit(1)
}

// 收到的字节数
const maxCount = 65535 * 10

const every = 1400     // 512
// 多少个客户端
const maxClient = 30

console.log("client host", proxy.clientHost, "random count is:", maxCount)

{
    const server = createSocket("udp4")

    server.setMaxListeners(10000)

    server.on("listening", () => {
        console.log(`listen`, proxy!.clientPort)
    })

    let totalCount = 0
    let clientCount = 0
    let activeCount = 0

    const clients = {} as Record<string, EventEmitter>

    server.on("message", (message, remote_info) => {

        const address = `${remote_info.address}:${remote_info.port}`
        let client = clients[address]

        if (client) {
            client.emit("data", message)
            return
        }

        activeCount++
        clientCount++

        console.log("new connection", clientCount, remote_info.address, remote_info.port)

        client = clients[address] = new EventEmitter()

        //@ts-ignore
        client.address = remote_info.address
        //@ts-ignore
        client.port = remote_info.port

        let count = 0
        let i = clientCount

        client.on("data", (data) => {

            count += data.length
            totalCount += data.length

            if (count == maxCount) {
                console.log(i, "done ok", count)
                client!.removeAllListeners()
                delete clients[address]
                activeCount--
            }

            if (activeCount == 0) {
                console.log("done,recv:", clientCount, "target:", totalCount, "client count", maxClient * maxCount)
                exit(1)
            }
        })

        client.emit("data", message)
    })

    setInterval(() => {
        console.log("recv count:", totalCount)
    }, 2000)

    server.bind(proxy.clientPort, "0.0.0.0")
}

{
    let totalCount = 0

    for (let i = 0; i < maxClient; ++i) {

        const client = createSocket("udp4")
        const index = i + 1

        client.connect(proxy.serverPort, () => {
            console.log(i, "connected", proxy!.serverPort)

            let count = 0

            //@ts-ignore
            const timer = setInterval(() => {
                if (maxCount == count) {
                    clearInterval(timer)
                    return
                }

                const len = Math.min(Math.floor(every + Math.random() * 100), maxCount - count)

                const buffer = Buffer.alloc(len, index)
                client.send(buffer)

                count += len
                totalCount += len

                if (count == maxCount) {
                    console.log(index, "sent count", count, "began to end")

                    setImmediate(() => {
                        client.close()
                    })
                }
            }, 100)
        })
    }

    setInterval(() => {
        console.log("sent count:", totalCount)
    }, 1000)
}









