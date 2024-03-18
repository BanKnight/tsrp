# tsrp
一个用纯ts实现的，用于端口映射的工具，将拥有公共ip的服务器的数据转发到内网，协议支持tcp + udp。

# 起因
市面上大受好评的frp以及nps，在支持vpn那几个udp端口映射的时候，无一例外的都会出现断流情况。

## 和frp的区别
只有一个程序，通过配置文件指定是作为服务端还是客户端。

# 部署
## docker 部署 
``` bash
服务端
docker run --restart=always --network host -d -v ${PWD}/server.yaml:/app/config.yaml --name tsrps ghcr.io/banknight/tsrp:master
客户端
docker run --restart=always --network host -d -v ${PWD}/client.yaml:/app/config.yaml --name tsrpc ghcr.io/banknight/tsrp:master
```
## 或者 docker compose 部署
``` yaml
version: '3'
services:
  tsrp:
    image: ghcr.io/banknight/tsrp:master
    container_name: tsrp
    restart: always
    network_mode: host
    volumes:
      - ./client.yaml:/app/config.yaml:ro
      - /etc/localtime:/etc/localtime:ro
      - /etc/timezone:/etc/timezone
```
## 配置参考
[服务端配置](https://github.com/BanKnight/tsrp/blob/master/server.example.yaml)
```yaml
name: server  # 名称
port: 8024    # 端口
token: tsrp   # 登录用的token
mode: server  # 运行模式

proxies: []  
```
[客户端配置](https://github.com/BanKnight/tsrp/blob/master/client.example.yaml)
```yaml
name: client      # 名称
host: 127.0.0.1   # 服务端地址
port: 8024        # 服务端端口
token: tsrp       # 登陆用的token
mode: client      # 运行模式
proxies:
  - name: udp-1081    # 名称
    type: udp         # 类型
    serverPort: 1081  # 服务端转发端口
    clientHost: 127.0.0.1    # 要转发到内网的ip
    clientPort: 1080         # 要转发到内网的端口
  - name: tcp-1081
    type: tcp
    serverPort: 1081
    clientHost: 127.0.0.1
    clientPort: 1080
```




