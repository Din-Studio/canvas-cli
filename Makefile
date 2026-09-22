BINARY   := scenemint-canvas
REPO     := Din-Studio/canvas-cli
VERSION  := $(shell node -p "require('./package.json').version" 2>/dev/null || echo dev)

.PHONY: all test check snapshot release-guard release clean

all: check

test:
	node --test test/*.test.mjs

# 发版前的完整闸门。release 会先跑它，也可单独执行。
check: test
	scripts/validate-skill.sh
	@command -v shellcheck >/dev/null 2>&1 && shellcheck scripts/install.sh || \
		echo "⚠️  未安装 shellcheck，跳过 shell 静态检查"

# 本地构建发布产物但不发布，用于发版前核对资产名与归档内容。
snapshot:
	node scripts/build-release.mjs
	@echo "✅ 产物在 dist/，检查资产名不含版本号、且归档内有 skills/scenemint-canvas/SKILL.md"

# 手动发版。本项目不使用 GitHub Actions 发版——组织级 Actions 不可用，
# push tag 不会产生任何 run 记录，详见 README「Releases」。
#
#   make release TAG=v0.10.2
# 守卫先于 check：打错 TAG 不该等整个测试套件跑完才报错。
release-guard:
	@test -n "$(TAG)" || { echo "❌ 用法: make release TAG=v0.10.2"; exit 1; }
	@echo "$(TAG)" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+$$' || \
		{ echo "❌ TAG 必须形如 v1.2.3，实际: $(TAG)"; exit 1; }
	@test "$(TAG)" = "v$(VERSION)" || { \
		echo "❌ TAG $(TAG) 与 package.json 版本 v$(VERSION) 不一致：先改版本再发版"; exit 1; }
	@test -z "$$(git status --porcelain)" || { echo "❌ 工作区有未提交改动"; exit 1; }
	@test "$$(git rev-parse --abbrev-ref HEAD)" = "main" || \
		{ echo "❌ 必须在 main 上发版，当前: $$(git rev-parse --abbrev-ref HEAD)"; exit 1; }
	@git rev-parse "$(TAG)" >/dev/null 2>&1 && { echo "❌ tag $(TAG) 已存在"; exit 1; } || true
	@test -n "$$GITHUB_TOKEN" || command -v gh >/dev/null 2>&1 || \
		{ echo "❌ 需要 GITHUB_TOKEN 或已登录的 gh"; exit 1; }

release: release-guard check
	git tag -a "$(TAG)" -m "$(TAG)"
	git push origin main
	git push origin "$(TAG)"
	node scripts/build-release.mjs
	GITHUB_TOKEN="$${GITHUB_TOKEN:-$$(gh auth token)}" gh release create "$(TAG)" \
		--repo "$(REPO)" \
		--title "$(TAG)" \
		--generate-notes \
		"dist/scenemint-canvas.tar.gz#$(BINARY) package tarball (no version in name)" \
		"dist/checksums.txt#SHA-256 checksums" \
		"scripts/install.sh#POSIX installer" \
		"scripts/install.ps1#Windows installer"
	@echo "✅ $(TAG) 已发布"
	@echo "   验证: curl -fsSL https://github.com/$(REPO)/releases/latest/download/install.sh | bash"

clean:
	rm -rf dist
