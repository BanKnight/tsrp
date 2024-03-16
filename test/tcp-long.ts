import { exit } from "process"
import { config } from "./config"
import { createConnection, createServer, Socket } from "net"
import { Proxy } from "~/type"

// 长时间测试发包，看看是否有协议问题或者内存问题
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

const every = 65535     // 512
// 多少个客户端
const maxClient = 50

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
            setInterval(() => {
                const len = Math.floor(Math.random() * every) + 1000
                const buffer = Buffer.alloc(len, (97 + index) % 255)

                client.write(buffer)

                sent += len
                totalSent += len
            }, 10)

            client.on("data", (data) => {
                recv += data.length
                totalRecv += data.length
                // socket.write(data)
            })
        })
    }

    setInterval(() => {
        console.log("client:", "totalSent:", totalSent, "totalRecv:", totalRecv, "sub", totalSent - totalRecv)
    }, 2000)
}