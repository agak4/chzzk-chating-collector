# Chat Trace

치지직 채널을 두 역할로 분리해 관리하는 개인용 채팅 수집기입니다.

- **수집 대상**: 다른 채팅방에서 발언을 찾을 스트리머 채널
- **조회 채팅방**: 1분마다 최근 채팅을 확인할 스트리머 채널

수집 서버는 각 조회 채팅방의 라이브 상태를 확인한 뒤, 치지직 채팅의 읽기 전용 연결로 최근 일반 채팅 100개를 가져옵니다. 발언자 ID가 수집 대상의 채널 ID와 일치하는 메시지만 저장합니다. 같은 메시지는 MongoDB의 고유 인덱스로 한 번만 저장됩니다.

## 구성

```text
Cloudflare Pages (web/) -> OCI Always Free VM (server/) -> MongoDB Atlas
                                      -> CHZZK chat read API/WebSocket
```

정적 프런트엔드와 수집 서버는 서로 다른 배포 단위입니다. 프런트엔드에는 비밀값을 넣지 않습니다. 브라우저에서 입력한 관리자 키는 해당 브라우저의 `localStorage`에만 보관되고, 서버의 `ADMIN_API_KEY`와 일치할 때만 수집 대상·조회 채팅방을 변경할 수 있습니다.

## 로컬 실행

1. `server/.env.example`을 `server/.env`로 복사한 뒤 `MONGODB_URI`, `ADMIN_API_KEY`를 채웁니다.
2. `cd server; npm install; npm test; npm start`
3. `web/`은 정적 파일입니다. 예: `npx serve ../web`
4. 웹의 `서버 설정`에서 `http://localhost:3000`과 관리자 키를 입력합니다.

## MongoDB Atlas

Atlas에서 M0 무료 클러스터를 만들고 애플리케이션 사용자를 만든 뒤 연결 문자열을 `MONGODB_URI`에 넣습니다. 서버가 시작하면 다음 컬렉션과 인덱스를 자동 생성합니다.

| 컬렉션 | 용도 |
| --- | --- |
| `targets` | 수집 대상 스트리머 |
| `rooms` | 조회할 채팅방 |
| `messages` | 수집된 채팅 |

현재 Atlas MCP 접근은 이 Atlas 조직에서 비활성화되어 있어, 이 작업에서는 실제 Atlas 연결을 생성하지 못했습니다. 조직 소유자가 AI client access를 활성화한 뒤 연결하면 MCP로 클러스터와 인덱스를 다시 확인할 수 있습니다.

## 권장 배포: 자동 과금 없는 서버

수집 서버는 **Oracle Cloud Always Free VM**을 권장합니다. 무료 계정 상태에서 Always Free 범위만 사용하면 신용카드가 자동 청구되지 않고, 유료 계정 전환은 콘솔에서 명시적으로 수행해야 합니다. Ubuntu 또는 Oracle Linux의 Always Free Eligible VM에 Docker를 설치한 뒤 다음처럼 실행합니다.

```bash
git clone <your-repository-url>
cd chzzk-chat-collector/server
cp .env.example .env
# .env의 값 입력
docker build -t chat-trace-collector .
docker run -d --restart unless-stopped --env-file .env -p 3000:3000 --name chat-trace-collector chat-trace-collector
```

운영에서는 OCI Security List 또는 NSG에서 TCP 3000을 프런트엔드 IP/도메인에 맞게 열고, Caddy 또는 Nginx로 HTTPS를 종료합니다. OCI 콘솔에서는 **Always Free Eligible** 표시가 있는 인스턴스만 생성하고, 평가판 종료 전에 유료 계정으로 업그레이드하지 않습니다.

## 정적 웹 배포

Cloudflare Pages에서 이 저장소의 `web` 디렉터리를 배포 디렉터리로 지정합니다. 빌드 명령은 비워 둡니다. Vercel도 같은 방식으로 `web`을 Root Directory로 지정해 정적 배포할 수 있습니다. 배포 URL을 확인한 뒤 서버 `.env`의 `CORS_ORIGIN`에 그 URL을 설정하고 서버를 다시 시작합니다.

## 제약

- 이 프로젝트는 치지직의 읽기 전용 채팅 연결을 이용합니다. 치지직 API/프로토콜이 변경되면 `server/src/chzzk.js`, `server/src/collector.js`의 보정이 필요할 수 있습니다.
- 1분마다 최근 100개를 재조회하는 방식입니다. 한 채팅방에서 1분 내 일반 채팅이 100개를 크게 넘으면 오래된 메시지를 놓칠 수 있습니다.
- 후원, 구독, 시스템 메시지는 저장하지 않습니다.

## 참고

- [Oracle Cloud Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Oracle Cloud Free Tier billing policy](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)
- [CHZZK Developers](https://chzzk.gitbook.io/chzzk)
