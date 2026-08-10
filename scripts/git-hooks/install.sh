#!/bin/sh
# Instala los git hooks versionados de este repositorio en .git/hooks/.
# Necesario tras cada `git clone` fresco: git no versiona .git/hooks/ por sí solo.
#
#   sh scripts/git-hooks/install.sh

set -e
root="$(git rev-parse --show-toplevel)"
cp "$root/scripts/git-hooks/pre-commit" "$root/.git/hooks/pre-commit"
chmod +x "$root/.git/hooks/pre-commit"
echo "Hook pre-commit instalado."
