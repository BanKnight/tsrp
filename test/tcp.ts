import { exit } from "process"
import { config } from "./config"
import { createConnection, createServer, Socket } from "net"
import { Proxy } from "~/type"

// 测试多个链接，多发包
let proxy: Proxy | undefined

for (const one of config.proxies) {
    if (one.type == "tcp") {
        proxy = one
        break
    }
}

if (proxy == null) {
    exit(1)
}

// 收到的字节数
const maxCount = 65535 * 200

const every = 51200     // 512
// 多少个客户端
const maxClient = 20

console.log("client host", proxy.clientHost, "random count is:", maxCount)

{
    const server = createServer()
    server.setMaxListeners(10000)

    server.on("listening", () => {
        console.log(`listen`, proxy!.clientPort)
    })

    let totalCount = 0
    let clientCount = 0
    let activeCount = 0

    server.on("connection", (socket: Socket) => {

        activeCount++
        clientCount++

        let count = 0

        console.log("new connection", clientCount, socket.remoteAddress, socket.remotePort)

        socket.on("data", (data) => {
            count += data.length
            totalCount += data.length
            // socket.write(data)
        })

        let index = clientCount
        socket.once("close", () => {
            activeCount--

            if (count != maxCount) {
                console.error(index, "done,but count not ok", count, maxCount)
            }
            else {
                console.log(index, "done ok", count)
            }

            if (activeCount == 0) {
                console.log("done,recv:", clientCount, "target:", totalCount, "client count", maxClient * maxCount)
                exit(1)
            }
        })
    })

    setInterval(() => {
        console.log("recv count:", totalCount)
    }, 2000)

    server.listen(proxy.clientPort, "0.0.0.0")
}

{
    let totalCount = 0

    for (let i = 0; i < maxClient; ++i) {
        const client = createConnection({ host: "127.0.0.1", port: proxy.serverPort }, () => {
            console.log("connected", client.remoteAddress, client.remotePort)

            let count = 0
            let index = i + 1

            //@ts-ignore
            const timer = setInterval(() => {
                if (maxCount == count) {
                    clearInterval(timer)
                    return
                }

                const len = Math.min(Math.floor(every + Math.random() * 100), maxCount - count)

                const buffer = Buffer.alloc(len, (97 + i) % 255)
                client.write(buffer)

                count += len
                totalCount += len

                if (count == maxCount) {
                    console.log(index, "sent count", count, "began to end")
                    client.end(() => {
                        client.destroySoon()
                    })
                }
            }, 100)
        })

        client.setKeepAlive(true)
        client.setNoDelay(true)
    }

    setInterval(() => {
        console.log("sent count:", totalCount)
    }, 1000)
}









