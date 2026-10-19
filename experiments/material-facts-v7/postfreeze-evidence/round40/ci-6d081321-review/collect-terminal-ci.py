"""Read-only exact-head CI collection; never starts or reruns a workflow."""
from pathlib import Path, PurePosixPath
import datetime
import hashlib
import json
import stat
import subprocess
import zipfile

P = Path(__file__).resolve().parent
REPO = "ZZZZihan/anxin-work-rights"
RUN = 39161803412
HEAD = "6d081321b24b9fadd0088d6cc5b6c60e985eda26"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(name, data):
    f = P / name
    f.parent.mkdir(parents=True, exist_ok=True)
    with f.open("xb") as out:
        out.write(data)
    return f


def api(endpoint, name):
    r = subprocess.run(["gh", "api", endpoint], capture_output=True, timeout=180)
    if r.returncode:
        save(name + ".failure.stderr", r.stderr)
        raise RuntimeError(f"Read-only API request failed: {name}, exit {r.returncode}")
    save(name, r.stdout)
    return r.stdout


def json_api(endpoint, name):
    return json.loads(api(endpoint, name))


def unpack(blob, prefix, allowed):
    from io import BytesIO
    entries = []
    with zipfile.ZipFile(BytesIO(blob)) as z:
        for item in z.infolist():
            rel = PurePosixPath(item.filename)
            if rel.is_absolute() or ".." in rel.parts or "\\" in item.filename:
                raise RuntimeError("Unsafe archive path")
            if stat.S_ISLNK(item.external_attr >> 16):
                raise RuntimeError("Symlink archive member refused")
            if item.is_dir():
                continue
            data = z.read(item)
            permitted = allowed(item.filename)
            if permitted:
                save(str(PurePosixPath(prefix) / rel), data)
            entries.append({"name": item.filename, "bytes": len(data), "sha256": sha(data), "extracted": permitted})
    return entries


run = json.loads((P / "terminal-run.json").read_text())
assert run["id"] == RUN and run["head_sha"] == HEAD
assert run["status"] == "completed", "Wait for terminal status; this script does not poll"

raw = api(f"repos/{REPO}/actions/runs/{RUN}/logs", f"run{RUN}-original-logs.zip")
members = unpack(raw, "original-logs", lambda name: name.endswith(".txt"))
save("original-logs-manifest.json", (json.dumps({"zip_sha256": sha(raw), "entries": members}, indent=2) + "\n").encode())
r = subprocess.run(["gh", "run", "view", str(RUN), "--repo", REPO, "--log"], capture_output=True, timeout=180)
save("gh-run-complete.log", r.stdout)
save("gh-run-complete.stderr.log", r.stderr)
assert r.returncode == 0, r.returncode

arts = json_api(f"repos/{REPO}/actions/runs/{RUN}/artifacts?per_page=100", "artifacts-terminal.json")
downloaded = []
whitelist = {
    "http-results.json", "anxin-worker.log", "synthetic-http-results.json", "synthetic-http-results.worker.log",
    "http-production.json", "http-images.json", "http-facts.json", "http-fact-cancel.json", "http-fact-poll.json", "http-fact-recovery.json", "http-facts-v7.json",
}
for a in arts["artifacts"]:
    assert a["name"] in {"base-http-regression", "material-http-regression"}, a["name"]
    name = f"artifact-{a['id']}-{a['name']}.zip"
    blob = api(f"repos/{REPO}/actions/artifacts/{a['id']}/zip", name)
    entries = unpack(blob, f"artifacts/{a['name']}", lambda x: PurePosixPath(x).name in whitelist)
    digest = a.get("digest")
    downloaded.append({"id": a["id"], "name": a["name"], "file": name, "sha256": sha(blob), "api_digest": digest, "digest_matches": digest == "sha256:" + sha(blob), "entries": entries})
save("downloaded-artifacts-manifest.json", (json.dumps(downloaded, indent=2) + "\n").encode())

json_api(f"repos/{REPO}/commits/{HEAD}/check-runs?per_page=100", "checks-exact-head-terminal.json")
json_api(f"repos/{REPO}/commits/{HEAD}/status", "combined-status-exact-head-terminal.json")
json_api(f"repos/{REPO}/deployments?sha={HEAD}&per_page=100", "deployments-exact-head-terminal.json")
identity = json.loads((P / "static-identity-at-start.json").read_text())
merge = identity["pull_merge_sha_at_read"]
json_api(f"repos/{REPO}/git/commits/{merge}", "merge-commit-api-terminal.json")
json_api(f"repos/{REPO}/deployments?sha={merge}&per_page=100", "deployments-merge-terminal.json")
json_api(f"repos/{REPO}/pulls/45", "pull45-terminal.json")

query = '''query($after:String){repository(owner:"ZZZZihan",name:"anxin-work-rights"){pullRequest(number:45){headRefOid reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated path line resolvedBy{login} comments(first:20){nodes{id databaseId createdAt url body}}}}}}}'''
cursor = None
nodes = []
i = 1
while True:
    cmd = ["gh", "api", "graphql", "-f", "query=" + query]
    if cursor:
        cmd += ["-f", "after=" + cursor]
    r = subprocess.run(cmd, capture_output=True, timeout=90)
    assert r.returncode == 0
    save(f"review-threads-terminal-page-{i}.json", r.stdout)
    q = json.loads(r.stdout)["data"]["repository"]["pullRequest"]
    page = q["reviewThreads"]
    nodes.extend(page["nodes"])
    if not page["pageInfo"]["hasNextPage"]:
        break
    cursor = page["pageInfo"]["endCursor"]
    i += 1
state = {"observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "head_at_review_read": q["headRefOid"], "threads": len(nodes), "unresolved": [x for x in nodes if not x["isResolved"]]}
save("review-thread-state-terminal.json", (json.dumps(state, ensure_ascii=False, indent=2) + "\n").encode())
print(json.dumps({"run": RUN, "conclusion": run["conclusion"], "log_members": len(members), "artifacts": len(downloaded), "artifact_digests_match": all(a["digest_matches"] for a in downloaded), "threads": len(nodes), "unresolved": len(state["unresolved"])}))
