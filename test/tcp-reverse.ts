import { exit } from "process"
import { config } from "./config"
import { createConnection, createServer, Socket } from "net"
import { Proxy } from "~/type"

// 测试多个链接，来回发包，看看中间是否有丢包
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
const maxCount = 65535 * 20

const every = 5120     // 512
// 多少个客户端
const maxClient = 10

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

    server.on("connection", (client: Socket) => {

        activeCount++
        clientCount++

        let index = clientCount

        console.log(index, "new connection", clientCount, client.remoteAddress, client.remotePort)

        client.setKeepAlive(true)
        client.setNoDelay(true)

        client.on("data", (data) => {
            totalCount += data.length
            client.write(data)
        })
    })

    setInterval(() => {
        console.log("server:", "recv and sent count:", totalCount)
    }, 2000)

    server.listen(proxy.clientPort, "0.0.0.0")
}

{
    let totalSent = 0
    let totalRecv = 0
    let activeCount = 0

    for (let i = 0; i < maxClient; ++i) {
        const client = createConnection({ host: "127.0.0.1", port: proxy.serverPort }, () => {

            activeCount++

            let sent = 0
            let recv = 0
            let index = i + 1

            client.setKeepAlive(true)
            client.setNoDelay(true)

            // console.log(index, "connected", client.remoteAddress, client.remotePort)

            //@ts-ignore
            const timer = setInterval(() => {
                if (maxCount == sent) {
                    clearInterval(timer)
                    return
                }

                const len = Math.min(Math.floor(every + Math.random() * 100), maxCount - sent)

                const buffer = Buffer.alloc(len, (97 + index) % 255)
                client.write(buffer)

                sent += len
                totalSent += len
            }, 100)

            client.on("data", (data) => {
                recv += data.length
                totalRecv += data.length
                // socket.write(data)

                if (recv == maxCount) {
                    console.log(index, "recv count", recv, "began to end")
                    client.end(() => {
                        client.destroySoon()
                    })
                }
            })

            client.once("close", () => {
                activeCount--

                if (recv != maxCount) {
                    console.error(index, "done,but count not ok", sent, maxCount)
                }
                else {
                    console.log(index, "done ok", recv)
                }

                if (activeCount == 0) {
                    if (totalRecv == totalSent) {
                        console.log("❤️❤️ done")
                    }
                    console.log("client", "done, totalSent: ", totalSent, "totalRecv: ", totalRecv, "target", maxClient * maxCount)
                    exit(1)
                }
            })
        })


    }

    setInterval(() => {
        console.log("client:", "totalSent:", totalSent, "totalRecv:", totalRecv, "target", maxClient * maxCount)
    }, 1000)
}









