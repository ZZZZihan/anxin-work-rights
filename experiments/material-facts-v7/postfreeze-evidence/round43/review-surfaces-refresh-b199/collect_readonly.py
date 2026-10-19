from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import subprocess

P = Path(__file__).resolve().parent
PREVIOUS = P.parents[1] / 'round42/ci-pr46-b199f521-review'
REPO = 'ZZZZihan/anxin-work-rights'
BASELINE = 'b199f52154d0eab731cb7d562ca02cff53021fe8'

def now():
    return datetime.now(timezone.utc).isoformat()

def sha(value):
    return hashlib.sha256(value).hexdigest()

def save(name, value):
    data = value if isinstance(value, bytes) else (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
    with (P / name).open('xb') as output:
        output.write(data)

def request(args, name):
    started = now()
    result = subprocess.run(args, capture_output=True, timeout=55)
    save(name, result.stdout)
    if result.stderr:
        save(name + '.stderr', result.stderr)
    save(name + '.request.json', {'started_at': started, 'finished_at': now(), 'args': args, 'exit': result.returncode,
        'bytes': len(result.stdout), 'sha256': sha(result.stdout), 'read_only': True})
    if result.returncode:
        raise RuntimeError(name + ': request failed ' + str(result.returncode))
    return json.loads(result.stdout)

def surface(number):
    endpoints = {'reviews': f'pulls/{number}/reviews', 'ordinary': f'issues/{number}/comments', 'inline': f'pulls/{number}/comments'}
    def rest(item):
        label, endpoint = item
        pages = request(['gh', 'api', '--paginate', '--slurp', f'repos/{REPO}/{endpoint}?per_page=100'], f'pr{number}-{label}.raw.json')
        return label, [row for page in pages for row in page]
    with ThreadPoolExecutor(max_workers=3) as executor:
        collected = dict(executor.map(rest, endpoints.items()))
    query = '''query($after:String){repository(owner:"ZZZZihan",name:"anxin-work-rights"){pullRequest(number:NUMBER){headRefOid state merged reviewDecision reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor}nodes{id isResolved isOutdated path line resolvedBy{login}comments(first:100){pageInfo{hasNextPage endCursor}nodes{id databaseId createdAt updatedAt url body author{login}}}}}}}}'''.replace('NUMBER', str(number))
    cursor, page, threads = None, 1, []
    while True:
        args = ['gh', 'api', 'graphql', '-f', 'query=' + query]
        if cursor:
            args += ['-f', 'after=' + cursor]
        data = request(args, f'pr{number}-threads-page-{page}.raw.json')
        assert not data.get('errors'), data.get('errors')
        pr = data['data']['repository']['pullRequest']
        connection = pr['reviewThreads']
        for thread in connection['nodes']:
            comments = thread['comments']
            comment_page = 1
            while comments['pageInfo']['hasNextPage']:
                more_query = '''query($id:ID!,$after:String!){node(id:$id){...on PullRequestReviewThread{comments(first:100,after:$after){pageInfo{hasNextPage endCursor}nodes{id databaseId createdAt updatedAt url body author{login}}}}}}'''
                more = request(['gh', 'api', 'graphql', '-f', 'query=' + more_query, '-f', 'id=' + thread['id'], '-f', 'after=' + comments['pageInfo']['endCursor']], f'pr{number}-thread-{thread["id"]}-comments-{comment_page}.raw.json')
                assert not more.get('errors'), more.get('errors')
                extra = more['data']['node']['comments']
                comments['nodes'] += extra['nodes']
                comments['pageInfo'] = extra['pageInfo']
                comment_page += 1
        threads += connection['nodes']
        if not connection['pageInfo']['hasNextPage']:
            break
        cursor, page = connection['pageInfo']['endCursor'], page + 1
    rest_ids = {row['id'] for row in collected['inline']}
    graphql_ids = {row['databaseId'] for thread in threads for row in thread['comments']['nodes']}
    assert rest_ids == graphql_ids, 'REST/GraphQL inline comment identity mismatch'
    result = {'observed_at': now(), 'pr': number, 'head': pr['headRefOid'], 'state': pr['state'], 'merged': pr['merged'], 'review_decision': pr['reviewDecision'],
        'reviews_count': len(collected['reviews']), 'nonempty_review_bodies': [row for row in collected['reviews'] if row.get('body', '').strip()],
        'ordinary_count': len(collected['ordinary']), 'ordinary_comments': collected['ordinary'], 'inline_comments_count': len(collected['inline']),
        'thread_count': len(threads), 'unresolved': [row for row in threads if not row['isResolved']], 'all_threads': threads,
        'rest_inline_graphql_ids_identical': True, 'all_pages_exhausted': True}
    save(f'pr{number}-surfaces.json', result)
    previous = json.loads((PREVIOUS / f'terminal-pr{number}-surface-summary.json').read_text())
    changes = {}
    for key in ['nonempty_review_bodies', 'ordinary_comments']:
        old = {row['id']: row for row in previous[key]}
        changes[key] = [{'id': row['id'], 'url': row.get('html_url'), 'created_at': row.get('created_at', row.get('submitted_at')),
            'classification': 'new' if row['id'] not in old else 'body_changed', 'body': row.get('body', '')} for row in result[key]
            if row['id'] not in old or row.get('body', '') != old[row['id']].get('body', '')]
    old_threads = {row['id']: row for row in previous['all_threads']}
    changes['threads'] = [{'id': row['id'], 'isResolved': row['isResolved'], 'isOutdated': row['isOutdated'], 'comments': row['comments']['nodes']} for row in threads
        if row['id'] not in old_threads or row['isResolved'] != old_threads[row['id']]['isResolved'] or {c['databaseId']: c['body'] for c in row['comments']['nodes']} != {c['databaseId']: c['body'] for c in old_threads[row['id']]['comments']['nodes']}]
    save(f'pr{number}-changes-since-cancelled-checkpoint.json', changes)
    print(json.dumps({'pr': number, 'head': result['head'], 'reviews': result['reviews_count'], 'ordinary': result['ordinary_count'], 'threads': result['thread_count'], 'unresolved': len(result['unresolved']), 'changed_surfaces': {key: len(value) for key, value in changes.items()}}, ensure_ascii=False), flush=True)
    return result

for number in [46, 45]:
    surface(number)
request(['gh', 'api', f'repos/{REPO}/actions/runs/39179544661'], 'b199-run-current.raw.json')
