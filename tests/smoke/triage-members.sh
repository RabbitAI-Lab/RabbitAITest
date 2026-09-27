#!/bin/bash
B=http://127.0.0.1:3000/api/v1
curl -s -c /tmp/t.jar -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@rabbit.test","password":"rabbit-admin-123"}' >/dev/null
GID=$(curl -s -b /tmp/t.jar "$B/system/groups" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];items=d if isinstance(d,list) else d.get('items',[]);print([g['id'] for g in items if g['scope']=='system' and '管理员' in g['name']][0])")
echo "GID=$GID"
curl -s -o /dev/null -w '非法 userIds: %{http_code}\n' -b /tmp/t.jar -X POST "$B/system/groups/$GID/members" -H 'Content-Type: application/json' -d '{"userIds":["not-a-uuid"]}'
UID=$(curl -s -b /tmp/t.jar "$B/system/users?page=1&pageSize=2" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];items=d['items'] if isinstance(d,dict) else d;print(items[1]['id'] if len(items)>1 else items[0]['id'])")
echo "UID=$UID"
curl -s -o /dev/null -w '合法 userIds: %{http_code}\n' -b /tmp/t.jar -X POST "$B/system/groups/$GID/members" -H 'Content-Type: application/json' -d "{\"userIds\":[\"$UID\"]}"
grep -B2 -A10 "unhandled" /tmp/rabbit-dev.log | tail -12
