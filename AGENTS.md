# dsh-browser-mode

DSH 鎻掍欢锛氬湪 Windows 妗岄潰绔爣棰樻爮銆岄噸鍚€嶆梺鍔犱竴涓€屾祻瑙堝櫒妯″紡銆嶆寜閽紝鐐逛竴涓嬪氨鎶婃祻瑙堝櫒鐧昏繘 DeepSeek Harness 鐨勭綉椤电晫闈€?
## 杩欐槸浠€涔堥棶棰?
妗岄潰绔敤 `?token=` 鐨勪竴娆℃€?URL 鎵撳紑缃戦〉绔紝閭ｄ釜 URL 鍙粡 IPC 浜ょ粰 Electron 绐楀彛锛屼笉钀界洏锛涚洿鎺ヨ闂?`http://127.0.0.1:<port>/` 鍙細鐪嬪埌 `dsh web authentication required`銆傛祻瑙堝櫒浼氳瘽 cookie 鐨勭鍚嶅瘑閽ユ槸鎸佷箙鍖栫殑锛坄~/.dsh/.credentials.yaml` 閲岀殑 `client-connection/browser-session`锛夛紝鎵€浠?Host 渚у彲浠ヨ嚜宸遍摳涓€涓瓑浠?cookie銆傛湰鎻掍欢灏卞仛杩欎欢浜嬶細鎸変笅鎸夐挳 鈫?妫€鏌ヨ姹傛祻瑙堝櫒鏄惁宸叉湁鏈夋晥 cookie 鈫?娌℃湁灏辩幇鍦洪摳涓€涓?7 澶?cookie锛岀敤涓€娆℃€ч摼鎺ワ紙`/dsh-browser-mode/login?n=鈥锛? 鍒嗛挓銆佸崟娆°€佸唴瀛?Map锛夐€氳繃 `Set-Cookie` 瑁呰繘娴忚鍣ㄥ苟 303 鍒?`/` 鈫?椤轰究鎵撳紑榛樿娴忚鍣ㄣ€?
## 鐩綍

| 璺緞 | 浣滅敤 |
|---|---|
| `index.js` | Host 渚э細涓夋潯璺敱 `/dsh-browser-mode/open`锛圥OST锛岄渶 `x-dsh-browser-mode: 1` 澶达級銆乣/login`銆乣/state`锛涢摳 cookie銆佺涓€娆℃€ч摼鎺ャ€佽法骞冲彴寮€娴忚鍣ㄣ€佹棩蹇楀啓 `~/.dsh/dsh-browser-mode.log` |
| `client.js` | 鍓嶇锛歚window.__ModuleLoader__.load(...)`锛屽線 `[data-windows-menu]` shadow root 鐨?menubar 閲屾彃鎸夐挳锛堢揣鎸?`[data-dsh-restart]` 涔嬪悗锛夛紝鑷缓 shadow DOM 瀵硅瘽妗?|
| `cordis.patch.yml` | bundle 琛ヤ竵锛歚- insert: [{id: dsh-browser-mode, name: 'dsh-browser-mode'}]` |
| `package.json` | `dsh.bundle.patch` + `dsh.client`锛坧latform web / immediately / inject `@deepseek-ai/dsh-client-ui-conversation`锛? `dsh.engines.dsh >=0.2.0-rc.1` |
| `locale/{zh,en}.json` | 鎻掍欢椤垫爣棰?鎻忚堪 + `meta.detail` 鎸囧悜 `docs/DETAIL*.md` |
| `docs/DETAIL*.md` | **鍙兘鏈変竴琛?* `![alt](preview.svg)`锛堟彃浠跺競鍦虹殑纭姹傦級 |
| `assets/screenshot-titlebar.png` + `screenshots.json` | 甯傚満鍗＄墖鎴浘锛? 寮狅紝鏍囬鏍忥級 |
| `.secrets/github-token.txt` | GitHub token锛?*宸插湪 .gitignore 閲岋紝姘歌繙涓嶈鎻愪氦** |
| `.marketplace/dsh-browser-mode.yml` | 缁?awesome-dsh-plugin 鐨勫競鍦烘潯鐩紙鏈湴鑽夌锛?|

## 鏃ュ父鏀规硶涓庨獙璇?
```powershell
# 鏀瑰畬浠ｇ爜蹇呴』璁?plugin_manager 閲嶆柊鍔犺浇锛坙inked 鐩綍涓嶄細鐑洿鏂?Host 渚э級
plugin_manager set_bundle target=dsh-browser-mode enabled=false
plugin_manager set_bundle target=dsh-browser-mode enabled=true

# 涓変釜楠岃瘉鐐?Invoke-WebRequest http://127.0.0.1:59579/dsh-browser-mode/state      # 鏈熸湜 status=ok
# 鐐规爣棰樻爮鎸夐挳锛屾棩蹇楅噷搴旀湁 "minted a 7-day cookie 鈥?
Get-Content ~/.dsh/dsh-browser-mode.log -Tail 5
# 娴忚鍣ㄦ帀杩?401 鏃讹紝鎸夋寜閽簲褰撶洿鎺ユ斁琛岃€屼笉鏄啀鎶?401
```

娌℃湁鏋勫缓姝ラ锛屾病鏈変緷璧栵紝绾?ESM銆傚彂甯冿細`npm publish --access public`锛坱oken 宸插湪 npm 閰嶇疆閲岋紱鏂板寘棣栨浼氬厛鍑虹幇 `0.0.0-stage` 鍗犱綅锛岀瓑涓€涓ゅ垎閽燂級銆?
## 鍧戯紙閮借俯杩囦簡锛?
1. **涓嶈兘璇?`ctx.config`**锛岄櫎闈炲０鏄庝簡 `Config`锛歚Error: cannot get property "config" without inject`銆傚ぉ鏁扮洿鎺ョ敤甯搁噺 `DEFAULT_MAX_AGE_DAYS`銆?2. **`Credentials` 鏈嶅姟鐨?API**锛歚ctx.get('credentials').readRecord('client-connection/browser-session')` 杩斿洖 `{kind:'grant', payload:{version:1, secret:<base64url 32B>}}`銆傚埆鍘昏В鏋?YAML銆?3. **cookie 璇硶蹇呴』涓庡畼鏂逛竴鑷?*锛歯ame = `dsh-auth-` + b64url(sha256(authority))锛泇alue = `v1.<b64url(JSON{version,authority,issuedAt,expiresAt})>.<b64url(HMAC-SHA256(secret, body))>`锛沗HttpOnly; SameSite=Strict; Path=/`銆?4. **pnpm 鎹㈡簮鏃舵姤 EPERM**锛歱rofile 閲屾畫鐣欑殑鐩綍閾炬帴涓嶈兘鐢?`rmdir` 浠ュ鐨勫姙娉曞垹锛涘厛 `cmd /c rmdir <profile>\node_modules\dsh-browser-mode` 鍐嶈銆?5. **PowerShell 5.1 鐨?`Invoke-WebRequest -Headers @{Cookie=鈥` 浼氫涪 Cookie**锛屽繀椤荤敤 `WebRequestSession` + `System.Net.Cookie`銆?6. **`git push` 鐨勮璇?*锛氱敤 `-c http.extraHeader="Authorization: Basic <base64(Tino0713:token)>"`锛宍bearer` 涓嶈锛泃oken 鍒啓杩?remote URL銆?7. 鏈満鍒?github.com 鐨?git 閫氶亾鏃舵柇鏃剁画锛宍api.github.com` 閫氬父姝ｅ父鈥斺€擧TTP 鏂殑鏃跺€欏彲浠ヨ蛋 REST API 鎻愪氦銆?
## 褰撳墠鐘舵€侊紙2026-11-20锛?
- 鏈湴宸茶锛坙inked锛屾寚鍚戞湰鐩綍锛夛紝宸茬鍒扮楠岃瘉锛氭寜閽彲瑙併€侀摳 cookie銆佹祻瑙堝櫒鐪熸鍏戞崲鎴愬姛銆?- GitHub锛歚Tino0713/dsh-browser-mode`锛宍main` 鍒?`decaf2b` 宸叉帹锛涙湰鍦板彟鏈?2 涓彧鍚?`.gitignore` 鏀瑰姩鐨勬彁浜ゅ緟鎺ㄣ€?- npm锛歚dsh-browser-mode@0.1.2`锛坄repository` 鎸囧洖浠撳簱锛屽競鍦洪潬杩欎釜鍏宠仈锛夈€?- 甯傚満 PR锛歚awesome-dsh-plugin/awesome-dsh-plugin#17152`锛堝姞 `data/plugins/Tino0713__dsh-browser-mode.yml`锛夈€備粨搴撴槸褰撳ぉ鏂板缓鐨勶紝**CI 鐨勩€屼粨搴撴弧 1 澶┿€嶉棬妲涗細鑷姩杩囨湡閲嶈窇**锛屼笉瑕佷负姝ら噸鏂版彁 PR銆?- 鏈仛锛氬競鍦哄崱鐗囩洰鍓嶅彧鏈変竴寮犳爣棰樻爮鎴浘锛涘璇濇銆佺姸鎬佽鐨勬埅鍥惧彲浠ヨˉ銆?