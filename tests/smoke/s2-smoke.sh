#!/bin/bash
# S2 全栈冒烟（临时脚本，不进 CI）：环境→定义→用例→执行→报告→mock→分享→重跑→停止
set -e
B=http://127.0.0.1:3000/api/v1
curl -s -c /tmp/rabbit.jar -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@rabbit.test","password":"rabbit-admin-123"}' | head -c 120; echo
PID=$(curl -s -b /tmp/rabbit.jar $B/personal/projects | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(d['items'][0]['id'] if isinstance(d,dict) else d[0]['id'])")
echo "projectId=$PID"
ENV=$(curl -s -b /tmp/rabbit.jar -X POST $B/projects/$PID/environments -H 'Content-Type: application/json' -d '{"name":"冒烟环境","config":{"vars":[{"key":"base","value":"http://127.0.0.1:4000","enabled":true}],"http":[{"id":"def","name":"默认","protocol":"http","hostname":"127.0.0.1","port":4000,"pathPrefix":"","conditions":{}}],"hosts":[],"database":[],"pre":[],"post":[],"asserts":[],"extracts":[]}}')
echo "env: $(echo "$ENV" | head -c 200)"
ENVID=$(echo "$ENV" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
MOD=$(curl -s -b /tmp/rabbit.jar "$B/projects/$PID/modules?scene=api" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];items=d['items'] if isinstance(d,dict) else d;print(items[0]['id'])")
echo "api default module=$MOD"
cat > /tmp/api-req.json <<JSON
{"moduleId":"$MOD","name":"冒烟-查询","request":{"spec":{"method":"GET","url":"/hello","headers":[],"query":[],"body":{"kind":"none"},"auth":{"kind":"none"},"timeoutMs":10000,"followRedirects":false,"skipPre":false,"skipPost":false},"asserts":[{"kind":"status_code","path":"","op":"eq","expected":"200"},{"kind":"body_jsonpath","path":"$.message","op":"eq","expected":"hello"}],"pre":[],"post":[],"extracts":[{"source":"body","kind":"jsonpath","expression":"$.message","match":"first","variable":"greet","scope":"temp"}]},"response":{"status":200,"headers":[],"body":"{\"code\":0}"}}
JSON
API=$(curl -s -b /tmp/rabbit.jar -X POST $B/projects/$PID/apis -H 'Content-Type: application/json' -d @/tmp/api-req.json)
echo "$API" > /tmp/api-resp.json
echo "api: $(echo "$API" | head -c 160)"
APIID=$(python3 -c "import json;print(json.load(open('/tmp/api-resp.json'))['data']['id'])")
cat > /tmp/case-req.json <<JSON
{"name":"用例1","level":"P1","status":"UNDERWAY","tags":[],"request":{"spec":{"method":"GET","url":"\${base}/hello","headers":[],"query":[],"body":{"kind":"none"},"auth":{"kind":"none"},"timeoutMs":10000,"followRedirects":false,"skipPre":false,"skipPost":false},"asserts":[{"kind":"status_code","path":"","op":"eq","expected":"200"}],"pre":[],"post":[],"extracts":[]}}
JSON
CASE=$(curl -s -b /tmp/rabbit.jar -X POST $B/projects/$PID/apis/$APIID/cases -H 'Content-Type: application/json' -d @/tmp/case-req.json)
echo "$CASE" > /tmp/case-resp.json
echo "case: $(echo "$CASE" | head -c 160)"
CASEID=$(python3 -c "import json;print(json.load(open('/tmp/case-resp.json'))['data']['id'])")
TASK=$(curl -s -b /tmp/rabbit.jar -X POST $B/projects/$PID/apis/$APIID/cases/execute -H 'Content-Type: application/json' -d "{\"caseIds\":[\"$CASEID\"],\"envId\":\"$ENVID\",\"stopOnFail\":true}")
echo "task: $TASK"
TASKID=$(echo "$TASK" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['taskId'])")
for i in $(seq 1 20); do sleep 1; R=$(curl -s -b /tmp/rabbit.jar $B/projects/$PID/reports/$TASKID); ST=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['status'])"); echo "poll $i: $ST"; [ "$ST" != "PENDING" ] && [ "$ST" != "RUNNING" ] && break; done
echo "$R" | python3 -m json.tool
echo "=== TASKID=$TASKID APIID=$APIID CASEID=$CASEID ENVID=$ENVID PID=$PID ==="
