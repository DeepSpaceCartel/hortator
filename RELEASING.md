# Releasing

The extension is published to the VS Code Marketplace and Open VSX under the publisher/namespace `deepspacecartel`.

## One-time setup

**VS Code Marketplace**

1. Create the publisher `deepspacecartel` at <https://marketplace.visualstudio.com/manage>.
2. Create an Azure DevOps personal access token with scope *Marketplace → Manage* for all accessible organizations.

**Open VSX**

1. Sign in at <https://open-vsx.org> with GitHub and create an access token.
2. Sign the publisher agreement, then create the namespace:
   ```
   npx ovsx create-namespace deepspacecartel -p "$OVSX_PAT"
   ```

## Each release

1. Update `version` in `package.json` and add a section to `CHANGELOG.md`.
2. Run the checks and build the package (no flags should be needed; warnings mean something is missing):
   ```
   npm test
   npx @vscode/vsce package
   npx @vscode/vsce ls          # confirm only the intended files ship
   ```
3. Install the `.vsix` locally and try it (see the README).
4. Commit, then tag and push:
   ```
   git tag v<version> && git push origin main v<version>
   ```
5. Publish the same `.vsix` to both registries:
   ```
   npx @vscode/vsce publish -p "$VSCE_PAT"
   npx ovsx publish hortator-<version>.vsix -p "$OVSX_PAT"
   ```

Regenerate the Marketplace icon with `python3 scripts/make-icon.py` if the design changes.
