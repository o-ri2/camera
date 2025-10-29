const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// HTTP 서버 생성
const server = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.woff': 'application/font-woff',
        '.ttf': 'application/font-ttf',
        '.eot': 'application/vnd.ms-fontobject',
        '.otf': 'application/font-otf',
        '.wasm': 'application/wasm'
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 - 페이지를 찾을 수 없습니다</h1>', 'utf-8');
            } else {
                res.writeHead(500);
                res.end('서버 오류: ' + error.code, 'utf-8');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

const PORT = process.env.PORT || 8080;

// WebSocket 서버 생성
const wss = new WebSocket.Server({ server });

// 연결된 클라이언트 분류
const artistClient = { ws: null }; // A사이트 (작가)
const viewerClients = new Set(); // B사이트 (관람객들)

console.log('🚀 전시용 서버 시작...');
console.log(`📡 포트: ${PORT}`);
console.log('👥 최대 관람객 수: 50명');

wss.on('connection', function connection(ws, req) {
    const clientIp = req.socket.remoteAddress;
    console.log(`✅ 새로운 연결: ${clientIp}`);

    // 클라이언트 타입 구분을 위한 플래그
    let clientType = null;

    ws.on('message', function incoming(message) {
        try {
            const data = JSON.parse(message);
            
            // 클라이언트 타입 등록
            if (data.type === 'register') {
                if (data.role === 'artist') {
                    // 작가(A사이트) 등록
                    if (artistClient.ws) {
                        console.log('⚠️  기존 작가 연결 종료');
                        artistClient.ws.close();
                    }
                    artistClient.ws = ws;
                    clientType = 'artist';
                    console.log('🎨 작가(A사이트) 연결됨');
                    
                    // 현재 관람객 수 전송
                    ws.send(JSON.stringify({
                        type: 'viewer_count',
                        count: viewerClients.size
                    }));
                    
                } else if (data.role === 'viewer') {
                    // 관람객(B사이트) 등록
                    if (viewerClients.size >= 50) {
                        console.log('⛔ 최대 인원 초과, 연결 거부');
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: '최대 인원(50명)에 도달했습니다.'
                        }));
                        ws.close();
                        return;
                    }
                    
                    viewerClients.add(ws);
                    clientType = 'viewer';
                    console.log(`👤 관람객 연결됨 (현재 ${viewerClients.size}명)`);
                    
                    // 작가에게 관람객 수 업데이트
                    if (artistClient.ws && artistClient.ws.readyState === WebSocket.OPEN) {
                        artistClient.ws.send(JSON.stringify({
                            type: 'viewer_count',
                            count: viewerClients.size
                        }));
                    }
                }
                return;
            }
            
            // 버튼 클릭 메시지 (B -> A로만 전달)
            if (data.type === 'button_click' && clientType === 'viewer') {
                console.log(`🖱️  관람객 버튼 클릭: ${data.button}`);
                
                // 작가의 A사이트로만 전달
                if (artistClient.ws && artistClient.ws.readyState === WebSocket.OPEN) {
                    artistClient.ws.send(JSON.stringify(data));
                }
            }
            
            // 카메라 상태 메시지 (A -> 모든 B로 전달)
            if (data.type === 'camera_status' && clientType === 'artist') {
                console.log(`📹 카메라 상태: ${data.status}`);
                
                // 모든 관람객에게 브로드캐스트
                viewerClients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(data));
                    }
                });
            }
            
        } catch (error) {
            console.error('❌ 메시지 처리 오류:', error);
        }
    });

    // 연결 종료 처리
    ws.on('close', function close() {
        console.log(`❌ 연결 종료: ${clientIp}`);
        
        if (clientType === 'artist') {
            artistClient.ws = null;
            console.log('🎨 작가 연결 종료됨');
        } else if (clientType === 'viewer') {
            viewerClients.delete(ws);
            console.log(`👤 관람객 퇴장 (현재 ${viewerClients.size}명)`);
            
            // 작가에게 관람객 수 업데이트
            if (artistClient.ws && artistClient.ws.readyState === WebSocket.OPEN) {
                artistClient.ws.send(JSON.stringify({
                    type: 'viewer_count',
                    count: viewerClients.size
                }));
            }
        }
    });

    // 에러 처리
    ws.on('error', function error(err) {
        console.error('⚠️  WebSocket 에러:', err);
        if (clientType === 'viewer') {
            viewerClients.delete(ws);
        }
    });

    // 연결 확인용 핑
    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        } else {
            clearInterval(pingInterval);
        }
    }, 30000); // 30초마다
});

// HTTP 서버 시작
server.listen(PORT, () => {
    console.log(`✅ 서버가 http://localhost:${PORT} 에서 실행중입니다`);
    console.log('');
    console.log('📱 접속 방법:');
    console.log('   작가(A사이트): http://localhost:' + PORT + '/site-a.html');
    console.log('   관람객(B사이트): http://localhost:' + PORT + '/site-b.html');
});

// 서버 종료 처리
process.on('SIGINT', function() {
    console.log('\n🛑 서버 종료중...');
    
    // 모든 클라이언트 연결 종료
    if (artistClient.ws) {
        artistClient.ws.close();
    }
    viewerClients.forEach(client => {
        client.close();
    });
    
    server.close(() => {
        console.log('✅ 서버가 정상적으로 종료되었습니다.');
        process.exit(0);
    });
});

// 에러 처리
wss.on('error', function error(err) {
    console.error('⚠️  서버 에러:', err);
});
