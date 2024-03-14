import { exit } from "process"
import { config } from "./config"
import { createConnection, createServer, Socket } from "net"

// 测试单个链接，多发包
const proxy = config.proxies[0]!

// 收到的字节数
const maxCount = 65536 * 200

const every = Math.floor(maxCount / 10)
// 多少个客户端
const maxClient = 2

console.log("client host", proxy.clientHost, "random count is:", maxCount)

{
    const server = createServer()
    server.setMaxListeners(10000)

    server.on("listening", () => {
        console.log(`listen`, proxy.clientPort)
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

        let i = clientCount - 1
        socket.once("close", () => {
            activeCount--

            if (count != maxCount) {
                console.error(i, "done,but count not ok", count, maxCount)
            }
            else {
                console.log(i, "done ok", count)
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

            //@ts-ignore
            const timer = setInterval(() => {
                if (maxCount == count) {
                    clearInterval(timer)
                    return
                }

                const len = Math.min(every, maxCount - count)

                const buffer = Buffer.allocUnsafe(len)
                client.write(buffer)

                count += len
                totalCount += len

                if (count == maxCount) {
                    console.log(i, "sent count", count, "began to end")
                    client.end(() => {
                        client.destroySoon()
                    })
                }
            }, 1000)
        })

        client.setKeepAlive(true)
        client.setNoDelay(true)
    }

    setInterval(() => {
        console.log("sent count:", totalCount)
    }, 1000)
}









