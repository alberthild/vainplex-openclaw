# Release Process — Vainplex OpenClaw Suite

## Suite Releases (monthly or on significant changes)

We publish **suite releases** that bundle all plugin versions with a changelog.
Tag format: `suite-YYYY.MM` (e.g. `suite-2026.02`).

### When to release

- New plugin added to the suite
- Major feature shipped in any plugin (new RFC implemented, etc.)
- End of month if there were meaningful changes
- NOT for every minor bugfix (those go to npm only)

### Checklist

1. **Verify npm ↔ local versions match** for all packages:
   ```bash
   for dir in packages/openclaw-*/; do
     PKG_NAME=$(python3 -c "import json; print(json.load(open('$dir/package.json'))['name'])")
     LOCAL=$(python3 -c "import json; print(json.load(open('$dir/package.json'))['version'])")
     NPM=$(npm view "$PKG_NAME" version 2>/dev/null || echo "NOT PUBLISHED")
     echo "$PKG_NAME: local=$LOCAL npm=$NPM"
   done
   ```

2. **Check standalone plugins** (leuko, membrane):
   ```bash
   for pkg in leuko membrane; do
     npm view "@vainplex/openclaw-$pkg" version
   done
   ```

3. **Write release notes** with:
   - Package version table
   - Highlights since last release
   - Test count: `find packages -name "*.test.ts" -exec grep -c "it(" {} + | awk -F: '{sum+=$2} END{print sum}'`
   - Install instructions

4. **Create GitHub release**:
   ```bash
   gh release create suite-YYYY.MM \
     --title "Vainplex OpenClaw Suite — Month YYYY" \
     --notes-file /tmp/release-notes.md \
     --latest
   ```

5. **Verify**: https://github.com/alberthild/vainplex-openclaw/releases

### Per-package npm publish (on every code change)

Separate from suite releases. Every code change → bump → publish:

```bash
cd packages/openclaw-<name>
npm version patch  # or minor/major
npm run build && npm test
npm publish
git add -A && git commit -m "release(<name>): vX.Y.Z — <what changed>"
git push
```

This is mandatory per Albert's rule (2026-02-19): code change + npm publish in one flow.

## History

| Release | Date | Plugins | Tests |
|---------|------|---------|-------|
| `suite-2026.02` | 2026-02-24 | 7 | 1,848 |
| `cortex-v0.4.0` | 2026-02-19 | 1 (legacy) | ~850 |
