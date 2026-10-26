# Ghim credential git cho riêng repo này

## Vấn đề

Helper credential của git trên máy này là `!gh auth git-credential` (đặt ở `~/.gitconfig`,
phạm vi **toàn máy**). Helper đó **không nhận cờ và không nhận tên tài khoản** — nó trả về tài
khoản `gh` nào đang **hoạt động**. Máy có hai tài khoản: `lmtiep` (cá nhân) và `ecommeanblvd`
(chủ repo này).

Hệ quả: hễ `gh` đang hoạt động ở `lmtiep` thì `git push` repo này **trượt 403**
(`Permission to ecommeanblvd/Shopify-Management-System.git denied to lmtiep`) — và nó sẽ còn
tái diễn mỗi lần tài khoản hoạt động bị lật, kể cả lật ngầm.

## Hai cách đã THỬ và KHÔNG được — đừng làm lại

1. **Ghim bằng tên trong URL.** `remote = https://ecommeanblvd@github.com/...` +
   `credential.username = ecommeanblvd`. Đo 26/10/2026: khi `gh` lật sang `lmtiep`, git báo
   `fatal: could not read Password for 'https://ecommeanblvd@github.com': Device not configured`.
   Helper của `gh` **fail-closed** khi tên không khớp, nó không đổi tài khoản theo tên.
2. **SSH.** `~/.ssh/config` đã có mục `Host github.com` trỏ `~/.ssh/id_ed25519_ecommeanblvd`
   với `IdentitiesOnly yes`, nhưng `ssh -T git@github.com` → `Permission denied (publickey)`:
   khoá **chưa được đăng ký trên GitHub**. Đăng ký nó cần cấp thêm scope `admin:public_key`
   cho `gh` — đó là cấu hình tài khoản, chủ máy tự làm.

## Cách ĐANG DÙNG: ghim thư mục cấu hình `gh`

`~/.config/gh/hosts.yml` chỉ dài ~100 byte và **không chứa token** (token nằm trong keyring
macOS, `gh` tra ra theo host + user). Trường `user:` là cái quyết định tài khoản hoạt động.
Nên dựng một thư mục cấu hình `gh` thứ hai chỉ khai `ecommeanblvd`, rồi buộc **riêng repo này**
dùng thư mục đó. Không có bí mật nào bị sao chép, và trạng thái toàn máy không bị đổi.

### Dựng lại sau khi clone mới

```bash
D=~/.config/gh-ecommeanblvd
mkdir -p "$D" && chmod 700 "$D"
printf 'github.com:\n    git_protocol: https\n    users:\n        ecommeanblvd:\n    user: ecommeanblvd\n' > "$D/hosts.yml"
cp ~/.config/gh/config.yml "$D/config.yml"
chmod 600 "$D"/*.yml

# Giá trị RỖNG đứng trước là bắt buộc: nó XOÁ danh sách helper tích luỹ từ
# /etc/gitconfig (osxkeychain) và ~/.gitconfig (gh toàn máy). Thiếu nó thì helper
# toàn máy vẫn được hỏi TRƯỚC và vẫn trả về tài khoản sai.
git config --local --unset-all credential.helper
git config --local --add credential.helper ""
git config --local --add credential.helper '!GH_CONFIG_DIR=/Users/macos/.config/gh-ecommeanblvd /opt/homebrew/bin/gh auth git-credential'
```

### Kiểm chứng (đo 26/10/2026)

Lật `gh` toàn máy sang tài khoản SAI rồi thử — đó là điều kiện từng làm vỡ:

```bash
gh auth switch --hostname github.com --user lmtiep
cd <repo này>  && printf 'protocol=https\nhost=github.com\n\n' | git credential fill   # → username=ecommeanblvd
cd ~/Documents && printf 'protocol=https\nhost=github.com\n\n' | git credential fill   # → username=lmtiep
```

Trong repo này ra `ecommeanblvd`, ngoài repo vẫn ra `lmtiep`, và `git push --dry-run` trong repo
này **chạy được**. Tức: ghim đúng phạm vi một repo, và không phá các repo khác.
