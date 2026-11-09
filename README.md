# cmap-mcp

**Tiếng Việt** | [English](README.en.md)

Một công cụ dòng lệnh (`cmap`) và một máy chủ [MCP](https://modelcontextprotocol.io) giúp các coding agent (Claude Code, Codex, Cursor và các công cụ khác) đọc dữ liệu công khai trên [cmap.vn](https://cmap.vn), bản đồ văn hóa Việt Nam: sự kiện văn hóa, lễ hội, triển lãm, biểu diễn, thể thao và hoạt động cộng đồng, ưu đãi, địa điểm và tỉnh thành.

Cả hai lối vào đều là lớp vỏ mỏng bọc quanh cùng một thư viện lõi, nên chúng trả về cùng một dữ liệu.

## Dữ liệu và ghi nguồn

Dữ liệu thuộc về cmap.vn và đơn vị vận hành trang. Dự án này không lưu trữ hay phân phối lại dữ liệu: nó lấy dữ liệu lúc chạy từ JSON API công khai của trang, giữ một bộ đệm cục bộ, và mỗi bản ghi đều có trường `url` dẫn về trang tương ứng trên cmap.vn. Vui lòng ghi nguồn cmap.vn khi bạn dùng kết quả. Các yêu cầu được gửi một cách lịch sự (tối đa 4 yêu cầu cùng lúc, User-Agent `cmap-mcp/<version>`, chờ rồi thử lại khi gặp 429 và 5xx, mỗi lần làm mới toàn bộ cách nhau ít nhất vài phút). Hãy đọc điều khoản của trang hoặc hỏi đơn vị vận hành trước khi phân phối lại dữ liệu cho mục đích thương mại hay công khai.

## Cài đặt

Không cần cài đặt nếu bạn có Node 22+ hoặc Bun:

```bash
npx -y cmap-mcp events search "ha noi"
bunx cmap-mcp events search "ha noi"
```

Các cách khác:

- **Cài toàn cục:** `npm install -g cmap-mcp` hoặc `bun add -g cmap-mcp`, rồi chạy `cmap`.
- **Tệp chạy độc lập** (không cần Node hay Bun) trên [GitHub Releases](https://github.com/cuongtranba/cmap-mcp/releases): `cmap-linux-x64`, `cmap-linux-arm64`, `cmap-darwin-x64`, `cmap-darwin-arm64` và `cmap-windows-x64.exe`, kèm tệp `SHA256SUMS` để kiểm tra.
- **Docker:** `docker run -p 8787:8787 ghcr.io/cuongtranba/cmap-mcp` khởi động máy chủ MCP ở chế độ HTTP. Image được phát hành cho `linux/amd64` và `linux/arm64` với các tag `latest`, `<major>.<minor>` và `<version>` (ví dụ `0.1.0`).
- **Agent skill:** `npx skills add cuongtranba/cmap-mcp` (hoặc `bunx skills add cuongtranba/cmap-mcp`) dạy agent khi nào và cách gọi CLI. Xem [skills/cmap/SKILL.md](skills/cmap/SKILL.md).

## CLI

```
cmap sync | cmap status
cmap events search [query] --province --type --category --from --to --free|--paid --highlight --limit --offset --lang
cmap events near <lat> <lng> [--radius-km] [--limit]
cmap event get <id|slug> [--lang]
cmap offers search [query] --province --kind --limit --offset
cmap offer get <id|slug>
cmap provinces | cmap province get <id|slug|name> | cmap places [--province --type] | cmap taxonomies
cmap mcp [--http host:port]
cmap --version | cmap --help | cmap <command> --help
```

Cờ dùng chung: `--refresh` (đồng bộ từ cmap.vn trước), `--max-age <minutes>` (đồng bộ lại khi bộ đệm cũ hơn số phút này; mặc định 60), `--text` (xuất dạng dễ đọc thay vì JSON), `--lang vi|en`.

```bash
cmap events search "ngay van hoa" --from 2026-11-24 --to 2026-11-24
cmap events search --province "Ha Noi" --free --limit 10 --text
cmap events near 21.0285 105.8542 --radius-km 5
cmap event get am-vang-dong-que-9TXHDc --lang en
cmap province get "da nang"
cmap offers search "bao tang"
cmap taxonomies
```

- Tìm kiếm không phân biệt dấu tiếng Việt (`ha noi` tìm thấy `Hà Nội`). Ngày có dạng `YYYY-MM-DD`. `--from`/`--to` giữ lại các sự kiện có thời gian giao với khoảng ngày đã cho.
- Kết quả là JSON định dạng đẹp trên stdout. Khi có lỗi, lệnh thoát với mã 1 và in `{ "error": { "code", "message" } }` ra stderr (các mã `NOT_FOUND`, `VALIDATION`, `UPSTREAM`, `SYNC_REJECTED`, `NO_SNAPSHOT`); khi dùng sai cú pháp, lệnh thoát với mã 2 và in hướng dẫn.
- Lần gọi đầu tiên đồng bộ toàn bộ dữ liệu (khoảng 2 đến 6 giây); các lần sau đọc từ bộ đệm.

## Máy chủ MCP

Mười công cụ chỉ đọc, mỗi công cụ ứng với một phương thức của thư viện: `search_events`, `get_event`, `events_near`, `list_provinces`, `get_province`, `list_taxonomies`, `search_offers`, `get_offer`, `list_places`, `get_sync_status`. Mỗi công cụ đều có schema đầu vào và đầu ra và trả về `structuredContent`; lỗi của thư viện được trả về dưới dạng kết quả công cụ với `isError: true`.

Claude Code:

```bash
claude mcp add cmap -- npx -y cmap-mcp mcp
```

Codex, trong `~/.codex/config.toml`:

```toml
[mcp_servers.cmap]
command = "npx"
args = ["-y", "cmap-mcp", "mcp"]
```

Bất kỳ MCP client nào nhận cấu hình JSON:

```json
{
  "mcpServers": {
    "cmap": { "command": "npx", "args": ["-y", "cmap-mcp", "mcp"] }
  }
}
```

**Chế độ HTTP** (Streamable HTTP, không trạng thái): `cmap mcp --http 127.0.0.1:8787` phục vụ `POST /mcp` và `GET /healthz`. Dùng `--http :8787` để lắng nghe trên mọi giao diện mạng, ví dụ trong container:

```bash
docker run -p 8787:8787 -v cmap-cache:/data ghcr.io/cuongtranba/cmap-mcp
```

Image chạy bằng người dùng không phải root, giữ bộ đệm trong `/data` (`CMAP_CACHE_DIR=/data`) và có health check trên `GET /healthz`.

Ở chế độ stdio, máy chủ chỉ ghi thông điệp giao thức ra stdout; log được ghi ra stderr. Máy chủ nạp bộ đệm khi khởi động (đồng bộ trước nếu chưa có) và đồng bộ lại ở nền sau mỗi `CMAP_REFRESH_MIN` phút, giữ lại dữ liệu tốt gần nhất nếu một lần đồng bộ thất bại.

## Cấu hình

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `CMAP_BASE_URL` | `https://cmap.vn` | Địa chỉ gốc của nguồn dữ liệu |
| `CMAP_CACHE_DIR` | `~/.cache/cmap-mcp` | Thư mục chứa `snapshot.json` |
| `CMAP_MAX_AGE_MIN` | `60` | CLI đồng bộ lại khi bộ đệm cũ hơn số phút này |
| `CMAP_CONCURRENCY` | `4` | Số yêu cầu đồng thời tới nguồn dữ liệu |
| `CMAP_REFRESH_MIN` | `10` | Chu kỳ làm mới ở nền của máy chủ MCP, tính bằng phút |

## Cách hoạt động

Một lần đồng bộ lấy các taxonomy, rồi lấy **sự kiện theo từng tỉnh, mỗi tỉnh một lần** (34 yêu cầu, mỗi yêu cầu tối đa 100 sự kiện), cùng với ưu đãi và địa điểm, kiểm tra từng bản ghi bằng zod, loại bỏ bản trùng và thay kết quả mới vào một cách nguyên tử (`snapshot.json`). Tìm kiếm chạy trên snapshot đó, nên trả kết quả tức thì, không cần gõ dấu, và vẫn hoạt động khi cmap.vn chậm. Một lần đồng bộ thất bại hoặc đáng ngờ (hơn 10% bản ghi không hợp lệ) sẽ giữ lại snapshot trước đó. Chỉ phần nội dung dài của một sự kiện hoặc ưu đãi được lấy khi cần, theo id.

Cơ chế phân trang danh sách của chính trang web làm mất khoảng 20 sự kiện (thứ tự sắp xếp không ổn định), và các endpoint `resolve`, `map` và `facets` cũng mắc cùng lỗi này, nên không endpoint nào trong số đó được dùng để đảm bảo tính đúng đắn. Chi tiết và quá trình điều tra có trong [docs/design.md](docs/design.md) (tiếng Anh).

## Phát triển

Bun là bộ công cụ duy nhất.

```bash
bun install
bun run lint          # Biome
bun run typecheck     # tsc --noEmit
bun test              # chạy offline, với nguồn dữ liệu giả (test/fake-cmap.ts)
bun run build         # dist/cli.js, chạy được trên Node 22+
bun run build:bin     # tệp chạy độc lập cho máy hiện tại, dist/cmap
bun run build:binaries    # cả năm tệp chạy phát hành + SHA256SUMS trong dist/bin
bun run test:live     # kiểm tra cmap.vn thật: schema, cấu trúc khóa, 34 tỉnh, mỗi tỉnh <=100 sự kiện
bun run fixtures:record   # ghi lại test/fixtures từ API thật
bun run contract:record   # ghi lại test/contract/shape.json sau một thay đổi có chủ đích ở nguồn dữ liệu
```

Đọc [AGENTS.md](AGENTS.md) (tiếng Anh) trước khi sửa mã.

## CI và phát hành

GitHub Actions chỉ dùng Bun (`oven-sh/setup-bun`, phiên bản Bun lấy từ trường `packageManager` trong `package.json`).

- **`ci`** chạy trên mọi pull request và mọi lần push lên `main`: `bun install --frozen-lockfile`, lint, typecheck, `bun test`, `bun run build`, rồi các smoke test (`node dist/cli.js --version` và `--help` trên Node của runner, `--version` của tệp chạy linux-x64), `bun pm pack --dry-run` và một bước kiểm tra rằng `bunx skills add ./ --list` liệt kê `cmap`. Đây là status check bắt buộc cho `main`.
- **`live-e2e`** chạy các live test (`bun run test:live`) với cmap.vn thật mỗi ngày lúc 07:00 giờ Việt Nam (00:00 UTC), khi được kích hoạt thủ công, và trên các pull request có chạm tới `src/upstream`, `src/snapshot`, `test/live` hoặc `test/contract`. Khi một lần chạy theo lịch hoặc thủ công trên `main` thất bại, workflow mở một issue gắn nhãn `upstream-drift` ("cmap.vn upstream changed: live e2e failing") kèm liên kết tới lần chạy và 150 dòng output cuối, hoặc bình luận vào issue đang mở. Khi một lần chạy sau đó thành công, workflow đóng issue đó. Sau một thay đổi có chủ đích ở nguồn dữ liệu, hãy chạy `bun run contract:record` và commit tệp `test/contract/shape.json` mới.
- **`release`** chạy khi một tag `v*` được push.

Để phát hành:

```bash
bun pm version patch   # hoặc minor / major: tăng phiên bản trong package.json, commit và gắn tag vX.Y.Z
git push --follow-tags
```

Sau đó workflow `release` sẽ:

1. **verify** thất bại nếu tag không khớp với phiên bản trong `package.json`, và chạy lại toàn bộ các bước kiểm tra của `ci`.
2. **npm** phát hành bằng `bun publish --access public`, dùng secret `NPM_TOKEN` của repository. Đặt secret này một lần bằng `gh secret set NPM_TOKEN -R cuongtranba/cmap-mcp` (một npm automation token). `bun publish` hiện chưa tạo được provenance statement hay dùng npm trusted publishing, nên gói được phát hành không kèm provenance.
3. **binaries** đính kèm `cmap-linux-x64`, `cmap-linux-arm64`, `cmap-darwin-x64`, `cmap-darwin-arm64`, `cmap-windows-x64.exe` và `SHA256SUMS` vào một GitHub Release có ghi chú phát hành tự động.
4. **docker** push `ghcr.io/cuongtranba/cmap-mcp` cho `linux/amd64` và `linux/arm64` với các tag `<version>`, `<major>.<minor>` và `latest` (các tag pre-release như `v1.0.0-rc.1` không cập nhật `latest`), dùng `GITHUB_TOKEN` có sẵn.

Dependabot mở các pull request cập nhật hằng tuần cho GitHub Actions và các phụ thuộc Bun, gộp chung các bản cập nhật minor và patch.

## Giấy phép

MIT, xem [LICENSE](LICENSE). Dữ liệu do cmap.vn cung cấp không thuộc phạm vi giấy phép này.
