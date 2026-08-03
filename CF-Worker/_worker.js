//推荐使用Pages上传部署（如需wokers部署或反复部署就删除默认节点代码），无需自定义域名而且稳定
//默认UUID：1efbe8e6-5bb0-4d31-a20b-fe7a04f6644f 建议部署时修改
//默认反代IP：proxyip.cmliussss.net 无特殊要求无须修改
//部署后用手搓CF节点生成器(https://sub.cndyw.ggff.net/)生成节点导入到v2ray或karing中使用
//默认节点显示路径：https://部署域名/sub

import { connect } from 'cloudflare:sockets';

let 我的VL密钥 = '1efbe8e6-5bb0-4d31-a20b-fe7a04f6644f';//UUID
let 反代IP = 'proxyip.cmliussss.net'; //反代IP


// Dynamic node fetching from GitHub Actions (hourly updated per-region TXT files)
// 结果缓存：同一片区内避免每次请求都实时去抓 GitHub raw（耗时且易超时）
let 节点缓存 = { 数据: null, 时间: 0 };
const 缓存时长 = 30 * 1000; // 30 秒

async function fetchSpeedNodes(uuid, domain, proxyIP) {
  // 命中缓存则直接复用节点（秒回，避免 Clash 客户端 EOF）
  const now = Date.now();
  if (节点缓存.数据 && now - 节点缓存.时间 < 缓存时长) {
    return 节点缓存.数据;
  }

  const BASE = "https://raw.githubusercontent.com/wszhxz/CloudflareIP/main";
  const regionFiles = {
    SG: "SG.txt", JP: "JP.txt", DE: "DE.txt", NL: "NL.txt", US: "US.txt"
  };
  const cnames = { SG: "\u65b0\u52a0\u5761", JP: "\u65e5\u672c", US: "\u7f8e\u56fd", DE: "\u5fb7\u56fd", NL: "\u8377\u5170" };

  const nodes = [];

  try {
    // Fetch all per-region TXT files in parallel, with a hard 2s timeout each
    const fetches = {};
    for (const [code, file] of Object.entries(regionFiles)) {
      const 控制器 = new AbortController();
      const 超时 = setTimeout(() => 控制器.abort(), 2000);
      fetches[code] = fetch(BASE + "/" + file, { signal: 控制器.signal })
        .then(r => r.ok ? r.text() : "")
        .catch(() => "")
        .finally(() => clearTimeout(超时));
    }
    // HK removed: Cloudflare anycast IPs have no true geolocation

    const results = {};
    for (const code of Object.keys(fetches)) {
      results[code] = await fetches[code];
    }

    // Parse each region: take top 3 IPs (already sorted by latency in files)
    for (const [code, name] of Object.entries(cnames)) {
      const text = results[code];
      if (!text) continue;
      const lines = text.split("\n");
      const seen = new Set();
      let count = 0;
      for (const line of lines) {
        if (count >= 3) break;
        // SG.txt format: "IP#sg \u3010\u65b0\u52a0\u5761\u3011 SG"
        const m = line.match(/^([\d.]+)#/);
        if (!m) continue;
        const ip = m[1];
        if (seen.has(ip)) continue;
        seen.add(ip);
        nodes.push("vless://"+uuid+"@"+ip+":443?encryption=none&security=tls&sni="+domain+"&fp=random&type=ws&host="+domain+"&path=pyip%3D"+proxyIP+"#"+code+" "+name);
        count++;
      }
    }
  } catch (e) { console.error("fetchSpeedNodes error:", e.message); }

  // 写入缓存（即使为空也缓存，避免每次都重试拖慢）
  节点缓存 = { 数据: nodes, 时间: Date.now() };
  return nodes;
}
// 动态获取最新测速节点（从 GitHub Actions 产出）

// 生成 Clash Meta（mihomo / ClashMetaForAndroid）订阅 YAML 配置
function 生成Clash配置(节点列表, 部署域名, uuid, 反代IP) {
  // 先为每个节点生成唯一名称（同名节点加序号，避免 Clash 策略组引用冲突）
  const nameCount = {};
  const 命名节点 = 节点列表.map(node => {
    const m = node.match(/^vless:\/\/([^@]+)@([^:]+):([0-9]+)\?(.*)#(.+)$/);
    if (!m) return null;
    const [, , server, port, , name] = m;
    const base = name.replace(/"/g, `'`);
    nameCount[base] = (nameCount[base] || 0) + 1;
    const 唯一名 = nameCount[base] > 1 ? `${base}-${nameCount[base]}` : base;
    return { name: 唯一名, server, port };
  }).filter(Boolean);

  const proxies = 命名节点.map(({ name, server, port }) => [
    `  - name: "${name}"`,
    `    type: vless`,
    `    server: ${server}`,
    `    port: ${port}`,
    `    uuid: ${uuid}`,
    `    tls: true`,
    `    network: ws`,
    `    servername: ${部署域名}`,
    `    client-fingerprint: chrome`,
    `    ws-opts:`,
    `      path: "/pyip=${反代IP}"`,
    `      headers:`,
    `        Host: ${部署域名}`
  ].join('\n'));

  const proxyNames = 命名节点.map(n => n.name);
  const proxylist = proxyNames.map(n => `      - "${n}"`).join('\n');
  const grouplist = proxyNames.map(n => `      - "${n}"`).join('\n');

  return `# CloudflareIP Clash Meta 订阅
# 部署域名: ${部署域名}
port: 7890
socks-port: 7891
allow-lan: true
mode: rule
log-level: info
ipv6: false

proxies:
${proxies.join('\n')}

proxy-groups:
  - name: "🚀 节点选择"
    type: select
    proxies:
      - "♻️ 自动选择"
      - "DIRECT"
${proxylist}

  - name: "♻️ 自动选择"
    type: url-test
    url: "https://www.gstatic.com/generate_204"
    interval: 300
    tolerance: 50
    proxies:
${grouplist}

rules:
  - IP-CIDR,127.0.0.0/8,DIRECT,no-resolve
  - IP-CIDR,10.0.0.0/8,DIRECT,no-resolve
  - IP-CIDR,172.16.0.0/12,DIRECT,no-resolve
  - IP-CIDR,192.168.0.0/16,DIRECT,no-resolve
  - GEOIP,CN,DIRECT
  - MATCH,🚀 节点选择
`;
}

export default {
  async fetch(访问请求) {
    console.log('收到请求', 访问请求.method, 访问请求.url);
    if (访问请求.headers.get('Upgrade') === 'websocket') {
      const 读取路径 = decodeURIComponent(访问请求.url.replace(/^https?:\/\/[^/]+/, ''));
      反代IP = 读取路径.match(/ip=([^&]+)/)?.[1] || 反代IP;
      const [客户端, WS接口] = Object.values(new WebSocketPair());
      WS接口.accept();
      启动传输管道(WS接口);
      return new Response(null, { status: 101, webSocket: 客户端 });
    } else {
        const 请求URL = new URL(访问请求.url);
        const 部署域名 = 请求URL.hostname;
        const 请求路径 = 请求URL.pathname;
        const 节点路径 = '/sub';
        if (请求路径 === 节点路径) {
            // 动态拉取最新测速节点
            let 节点列表 = await fetchSpeedNodes(我的VL密钥, 部署域名, 反代IP);
            // 如果获取失败，使用静态后备
            if (节点列表.length === 0) {
                节点列表 = [
                    `vless://${我的VL密钥}@198.41.223.110:443?encryption=none&security=tls&sni=${部署域名}&fp=random&type=ws&host=${部署域名}&path=pyip%3D${反代IP}#SG 新加坡`,
                    `vless://${我的VL密钥}@162.159.38.118:443?encryption=none&security=tls&sni=${部署域名}&fp=random&type=ws&host=${部署域名}&path=pyip%3D${反代IP}#JP 日本`,
                    // HK removed: unreliable anycast geolocation
                    `vless://${我的VL密钥}@104.16.94.26:443?encryption=none&security=tls&sni=${部署域名}&fp=random&type=ws&host=${部署域名}&path=pyip%3D${反代IP}#US 美国`,
                    `vless://${我的VL密钥}@104.25.0.89:443?encryption=none&security=tls&sni=${部署域名}&fp=random&type=ws&host=${部署域名}&path=pyip%3D${反代IP}#DE 德国`,
                    `vless://${我的VL密钥}@188.114.97.3:443?encryption=none&security=tls&sni=${部署域名}&fp=random&type=ws&host=${部署域名}&path=pyip%3D${反代IP}#NL 荷兰`,
                ];
            }
            if (请求URL.searchParams.has('sub')) {
                const 原始 = 节点列表.join('\n');
                const 字节 = new TextEncoder().encode(原始);
                const base64订阅 = btoa(String.fromCharCode(...字节));
                return new Response(base64订阅, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
            }
            if (请求URL.searchParams.has('clash')) {
                const clash配置 = 生成Clash配置(节点列表, 部署域名, 我的VL密钥, 反代IP);
                return new Response(clash配置, { status: 200, headers: { 'Content-Type': 'text/yaml; charset=utf-8' } });
            }
            return new Response(`部署成功！

   你的UUID: ${我的VL密钥}
   你的部署域名：${部署域名}
   你的反代ip：${反代IP}

当前节点（自动匹配最新测速）：
${节点列表.join('\n')}

订阅链接：
Clash: https://${部署域名}/sub?clash
Shadowrocket: https://${部署域名}/sub?sub`, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        } else {
            return new Response('部署成功，使用你的路径查看节点信息！', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
    }
  }
};

async function 启动传输管道(WS接口, TCP接口) {
  let 识别地址类型, 访问地址, 地址长度, 首包数据 = false, 首包处理完成 = null, 传输数据, 读取数据, 传输队列 = Promise.resolve();
  try {
    WS接口.addEventListener('message', async event => {
      try {
        console.log('WS消息，类型:', typeof event.data, '原始类型:', event.data?.constructor?.name);
        // Convert event.data to ArrayBuffer if needed
        let rawData = event.data;
        if (typeof rawData === 'string') {
          const encoder = new TextEncoder();
          rawData = encoder.encode(rawData).buffer;
          console.log('转为ArrayBuffer，长度:', rawData.byteLength);
        } else if (rawData instanceof ArrayBuffer) {
          console.log('已是ArrayBuffer，长度:', rawData.byteLength);
        } else if (rawData && typeof rawData.arrayBuffer === 'function') {
          rawData = await rawData.arrayBuffer();
          console.log('调用arrayBuffer()，长度:', rawData.byteLength);
        } else {
          console.log('未知数据类型:', typeof rawData);
        }

        if (!首包数据) {
          首包数据 = true;
          首包处理完成 = 解析首包数据(rawData);
          传输队列 = 传输队列.then(() => 首包处理完成).catch(e => { console.error('首包处理失败:', e.message); throw e; });
        } else {
          await 首包处理完成;
          传输队列 = 传输队列.then(() => 传输数据.write(rawData)).catch(e => { console.error('写入失败:', e.message); throw e; });
        }
      } catch(err) {
        console.error('消息处理异常:', err.message);
      }
    });

    async function 解析首包数据(首包数据) {
      console.log('解析首包，字节长度:', 首包数据?.byteLength);
      const 二进制数据 = new Uint8Array(首包数据);
      const 协议头 = 二进制数据[0];
      const 验证VL的密钥 = (a, i = 0) => [...a.slice(i, i + 16)].map(b => b.toString(16).padStart(2, '0')).join('').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
      if (验证VL的密钥(二进制数据.slice(1, 17)) !== 我的VL密钥) throw new Error('UUID验证失败');
      console.log('UUID验证通过');
      const 提取端口索引 = 18 + 二进制数据[17] + 1;
      const 访问端口 = new DataView(二进制数据.buffer, 提取端口索引, 2).getUint16(0);
      const 提取地址索引 = 提取端口索引 + 2;
      识别地址类型 = 二进制数据[提取地址索引];
      let 地址信息索引 = 提取地址索引 + 1;
      switch (识别地址类型) {
        case 1:
          地址长度 = 4;
          访问地址 = 二进制数据.slice(地址信息索引, 地址信息索引 + 地址长度).join('.');
          break;
        case 2:
          地址长度 = 二进制数据[地址信息索引];
          地址信息索引 += 1;
          访问地址 = new TextDecoder().decode(二进制数据.slice(地址信息索引, 地址信息索引 + 地址长度));
          break;
        case 3:
          地址长度 = 16;
          const ipv6 = [];
          const 读取IPV6地址 = new DataView(二进制数据.buffer, 地址信息索引, 16);
          for (let i = 0; i < 8; i++) ipv6.push(读取IPV6地址.getUint16(i * 2).toString(16));
          访问地址 = ipv6.join(':');
          break;
        default:
          throw new Error('无效的访问地址');
      }
      console.log('目标:', 访问地址, '端口:', 访问端口);
      try {
        if (识别地址类型 === 3) {
          const 转换IPV6地址 = '[' + 访问地址 + ']';
          TCP接口 = connect({ hostname: 转换IPV6地址, port: 访问端口 });
        } else {
          TCP接口 = connect({ hostname: 访问地址, port: 访问端口 });
        }
        await TCP接口.opened;
        console.log('直连成功');
      } catch(e) {
        console.log('直连失败:', e.message, '走代理IP:', 反代IP);
        if (!反代IP) throw new Error('直连失败且未配置反代IP');
        const [反代IP地址, 反代IP端口 = 443] = 反代IP.split(':');
        TCP接口 = connect({ hostname: 反代IP地址, port: Number(反代IP端口) });
        await TCP接口.opened;
        console.log('代理IP连接成功');
      }
      console.log('TCP通道已打开');
      传输数据 = TCP接口.writable.getWriter();
      读取数据 = TCP接口.readable.getReader();
      const 写入初始数据 = 二进制数据.slice(地址信息索引 + 地址长度);
      if (写入初始数据.length > 0) try { await 传输数据.write(写入初始数据) } catch (e) { throw (e) };
      WS接口.send(new Uint8Array([协议头, 0]));
      console.log('已发送VLESS响应，启动回传管道');
      启动回传管道();
    }

    async function 启动回传管道() {
      while (true) {
        await 传输队列;
        const { done: 流结束, value: 返回数据 } = await 读取数据.read();
        if (返回数据 && 返回数据.length > 0) {
          传输队列 = 传输队列.then(() => WS接口.send(返回数据)).catch(e => { throw (e) });
        }
        if (流结束) break;
      }
      console.log('回传管道结束');
      throw new Error('传输完成');
    }
  } catch (e) {
    console.error('传输管道错误:', e.message);
    try { await TCP接口?.close?.() } catch {};
    try { WS接口?.close?.() } catch {};
  }
}
