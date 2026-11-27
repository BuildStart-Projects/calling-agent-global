#!/usr/bin/env bash
# Deploys BuildStart Global to the self-hosted Supabase instance "supabase3" ONLY.
# The server also runs other Supabase instances: this script never touches anything outside
# /opt/supabase-project3 or any compose project other than "supabase3".
#
#   SSH_KEY=~/.ssh/buildstart_deploy ./tools/deploy-supabase3.sh functions   # copy functions + restart functions container
#   SSH_KEY=~/.ssh/buildstart_deploy ./tools/deploy-supabase3.sh migrations  # apply new migrations through an SSH tunnel
#
# Secrets are NOT in this repo. On the server they live in /opt/supabase-project3/global-app.env (chmod 600),
# loaded by the functions service via env_file. Edit that file on the server, then run `functions`.
set -euo pipefail

HOST="${HOST:-root@178.104.127.220}"
DIR="/opt/supabase-project3"
PROJECT="supabase3"
: "${SSH_KEY:?set SSH_KEY to your deploy key path}"
SSH=(ssh -i "$SSH_KEY" -o IdentitiesOnly=yes)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

guard() { # refuse to continue unless the target folder is the supabase3 compose project
  "${SSH[@]}" "$HOST" "cd $DIR && grep -qx 'name: $PROJECT' docker-compose.yml" || { echo "Refusing: $DIR is not compose project $PROJECT" >&2; exit 1; }
}

case "${1:-}" in
  functions)
    guard
    rsync -a --exclude='.env' --exclude='.env.*' --exclude='main/' --exclude='*.test.ts' \
      -e "ssh -i $SSH_KEY -o IdentitiesOnly=yes" "$ROOT/supabase/functions/" "$HOST:$DIR/volumes/functions/"
    "${SSH[@]}" "$HOST" "cd $DIR && docker compose -p $PROJECT up -d --no-deps --force-recreate functions && docker compose -p $PROJECT ps functions"
    ;;
  migrations)
    guard
    : "${DB_PASSWORD:?set DB_PASSWORD (POSTGRES_PASSWORD of supabase3)}"
    TENANT=$("${SSH[@]}" "$HOST" "grep -E '^POOLER_TENANT_ID=' $DIR/.env | cut -d= -f2-")
    [[ "$TENANT" == supabase3-* ]] || { echo "Unexpected tenant id" >&2; exit 1; }
    "${SSH[@]}" -o ExitOnForwardFailure=yes -f -N -L 127.0.0.1:55436:127.0.0.1:5436 "$HOST"
    trap 'pkill -f "55436:127.0.0.1:5436" || true' EXIT
    EPW=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$DB_PASSWORD")
    (cd "$ROOT" && npx --yes supabase@latest db push --db-url "postgresql://postgres.$TENANT:$EPW@127.0.0.1:55436/postgres")
    ;;
  *) echo "usage: $0 functions|migrations" >&2; exit 2 ;;
esac
