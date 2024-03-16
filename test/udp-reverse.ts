import { exit } from "process"
import { config } from "./config"
import { createSocket } from "dgram";
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
const maxCount = 65535 * 200

const every = 1400     // udp 保持1400比较安全
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

    server.on("message", (message, remote_info) => {
        server.send(message, remote_info.port, remote_info.address)
        totalCount += message.length
    })

    setInterval(() => {
        console.log("💀 server:", " recv count:", totalCount)
    }, 2000)

    server.bind(proxy.clientPort, "0.0.0.0")
}

{
    let totalSent = 0
    let totalRecv = 0
    let activeCount = 0

    for (let i = 0; i < maxClient; ++i) {

        const client = createSocket("udp4")
        const index = i + 1

        client.connect(proxy.serverPort, () => {

            activeCount++

            console.log(i, "connected", proxy!.serverPort)

            let sentCount = 0
            let recvCount = 0

            //@ts-ignore
            const timer = setInterval(() => {
                if (maxCount == sentCount) {
                    clearInterval(timer)
                    return
                }

                const len = Math.min(Math.floor(every + Math.random() * 100), maxCount - sentCount)

                const buffer = Buffer.alloc(len, index)
                client.send(buffer)

                sentCount += len
                totalSent += len
            }, 10)

            client.on("message", (message) => {
                totalRecv += message.length
                recvCount += message.length

                if (recvCount == maxCount) {
                    setImmediate(() => {
                        client.close()
                    })
                }
            })

            client.once("close", () => {
                activeCount--
                console.log(index, "done ok,recv", recvCount, activeCount)
                client!.removeAllListeners()

                if (activeCount == 0) {
                    console.log("client", "done, totalSent: ", totalSent, "totalRecv: ", totalRecv, "target", maxClient * maxCount)
                    exit(1)
                }
            })
        })
    }

    setInterval(() => {
        console.log("😎 client:", "totalSent:", totalSent, "totalRecv:", totalRecv, "target", maxClient * maxCount)
    }, 2000)
}









