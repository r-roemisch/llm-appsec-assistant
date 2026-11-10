"""P6-A28: Dependency Files are read without a Model into PyPI and npm packages; pinned versions
are kept, ranges are marked unpinned, local and URL sources are skipped with a reason."""

import json

import pytest

from rampart.profile.dependency_files import (
    DependencyFileError,
    ParsedPackage,
    detect_format,
    parse_dependency_file,
)


def names(result) -> list[tuple[str, str | None]]:
    return [(p.name, p.version) for p in result.packages]


def test_requirements_txt():
    text = """
# a comment
Django==4.2.1  # pinned
requests>=2.25
Flask[async]==3.0.0 ; python_version >= "3.8"
numpy==1.26.*
uvicorn==0.30.0 \\
    --hash=sha256:abc
-r other.txt
-e ./local
git+https://github.com/x/y.git
pkg @ https://example.com/pkg.whl
"""
    result = parse_dependency_file(text, filename="requirements.txt")
    assert result.format == "requirements.txt"
    assert names(result) == [
        ("django", "4.2.1"),
        ("flask", "3.0.0"),
        ("numpy", None),  # a wildcard is not one version
        ("requests", None),
        ("uvicorn", "0.30.0"),
    ]
    assert len(result.skipped) == 4 and any("URL" in s for s in result.skipped)


def test_uv_lock_skips_the_project_itself():
    text = """
version = 1
requires-python = ">=3.12"

[[package]]
name = "my-app"
version = "0.1.0"
source = { editable = "." }

[[package]]
name = "Jinja2"
version = "2.10"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "local-lib"
version = "0.0.1"
source = { directory = "../lib" }
"""
    result = parse_dependency_file(text, filename="uv.lock")
    assert names(result) == [("jinja2", "2.10")]
    assert result.skipped == ["local-lib: a local path, not a PyPI release"]


def test_poetry_lock():
    text = """
[[package]]
name = "requests"
version = "2.25.0"
description = ""
python-versions = ">=3.7"

[metadata]
content-hash = "x"
"""
    result = parse_dependency_file(text)  # detected without a filename
    assert result.format == "poetry.lock" and names(result) == [("requests", "2.25.0")]


def test_pyproject_marks_ranges_unpinned():
    text = """
[project]
name = "app"
dependencies = ["fastapi>=0.100", "pydantic==2.7.0"]

[project.optional-dependencies]
dev = ["pytest==8.0.0"]

[dependency-groups]
lint = ["ruff", {include-group = "dev"}]

[tool.poetry.dependencies]
python = "^3.12"
httpx = "0.27.0"
rich = "^13.0"
mylib = { path = "../mylib" }
"""
    result = parse_dependency_file(text, filename="pyproject.toml")
    assert names(result) == [
        ("fastapi", None),
        ("httpx", "0.27.0"),
        ("pydantic", "2.7.0"),
        ("pytest", "8.0.0"),
        ("rich", None),
        ("ruff", None),
    ]
    assert any("mylib" in s for s in result.skipped)


def test_package_json():
    text = json.dumps(
        {
            "name": "web",
            "dependencies": {"lodash": "4.17.15", "react": "^18.2.0", "local": "file:../local"},
            "devDependencies": {"vite": "=5.0.0", "eslint": "latest"},
        }
    )
    result = parse_dependency_file(text, filename="package.json")
    assert names(result) == [("eslint", None), ("lodash", "4.17.15"), ("react", None), ("vite", "5.0.0")]
    assert result.skipped == ["local file:../local: not from the npm registry"]


def test_package_lock_v3_and_v1():
    v3 = {
        "name": "web",
        "lockfileVersion": 3,
        "packages": {
            "": {"name": "web", "version": "1.0.0"},
            "node_modules/lodash": {"version": "4.17.15"},
            "node_modules/@babel/core": {"version": "7.24.0"},
            "node_modules/a/node_modules/lodash": {"version": "4.17.21"},
            "node_modules/ws-local": {"link": True, "resolved": "packages/ws"},
        },
    }
    result = parse_dependency_file(json.dumps(v3))
    assert result.format == "package-lock.json"
    assert names(result) == [("@babel/core", "7.24.0"), ("lodash", "4.17.15"), ("lodash", "4.17.21")]
    v1 = {"lockfileVersion": 1, "dependencies": {"minimist": {"version": "1.2.0", "dependencies": {"x": {"version": "0.1.0"}}}}}
    assert names(parse_dependency_file(json.dumps(v1), filename="npm-shrinkwrap.json")) == [
        ("minimist", "1.2.0"),
        ("x", "0.1.0"),
    ]


def test_format_detection_and_errors():
    assert detect_format("requirements-dev.txt", "") == "requirements.txt"
    assert detect_format(None, "flask==3.0.0\n") == "requirements.txt"
    assert detect_format(None, "[project]\nname='x'\n") == "pyproject.toml"
    with pytest.raises(DependencyFileError):
        parse_dependency_file("{not json", filename="package.json")
    with pytest.raises(DependencyFileError):
        parse_dependency_file("[[package]\n", filename="uv.lock")


def test_duplicates_collapse_and_pinned_flag():
    result = parse_dependency_file("Django==4.2.1\ndjango==4.2.1\n")
    assert result.packages == [ParsedPackage("PyPI", "django", "4.2.1")]
    assert result.packages[0].pinned


# ---- through the API and a turn (P6-A28, P6-A29) --------------------------------------------------

import httpx  # noqa: E402

from helpers import Api, by_name, make_user, records, tool_call  # noqa: E402

LOCK = json.dumps(
    {
        "lockfileVersion": 3,
        "packages": {
            "": {"name": "web"},
            "node_modules/lodash": {"version": "4.17.15"},
            "node_modules/react": {"version": "18.2.0"},
        },
    }
)


def test_preview_then_merge_or_replace(app):
    make_user(app, "alice")
    alice = Api(app, "alice")
    assert alice.put("/api/profile", json={"stack": "A web app", "packages": [
        {"ecosystem": "npm", "name": "lodash", "version": "4.17.21"},
        {"ecosystem": "PyPI", "name": "Django", "version": "4.2.1"},
    ]}).status_code == 200

    preview = alice.post("/api/profile/dependency-file/preview", json={"content": LOCK, "filename": "package-lock.json"})
    assert preview.status_code == 200
    body = preview.json()
    assert body["format"] == "package-lock.json" and body["pinned"] == 2 and body["unpinned"] == 0
    assert alice.get("/api/profile").json()["packages"][0]["version"] == "4.17.21"  # nothing saved

    merged = alice.post("/api/profile/dependency-file/import", json={"content": LOCK, "filename": "package-lock.json"})
    assert merged.status_code == 200
    packages = {(p["ecosystem"], p["name"]): p["version"] for p in merged.json()["packages"]}
    # lodash takes the imported version, react is new, Django stays; the stack is untouched.
    assert packages == {("npm", "lodash"): "4.17.15", ("npm", "react"): "18.2.0", ("PyPI", "Django"): "4.2.1"}
    assert merged.json()["stack"] == "A web app"

    replaced = alice.post("/api/profile/dependency-file/import", json={"content": "flask==3.0.0\n", "replace": True})
    assert [(p["name"], p["version"]) for p in replaced.json()["packages"]] == [("flask", "3.0.0")]

    bad = alice.post("/api/profile/dependency-file/preview", json={"content": "{oops", "filename": "package.json"})
    assert bad.status_code == 422 and "could not read the file" in bad.json()["detail"]
    empty = alice.post("/api/profile/dependency-file/import", json={"content": "-r other.txt\n"})
    assert empty.status_code == 422
    assert alice.post("/api/profile/dependency-file/preview", json={"content": LOCK}, csrf=False).status_code == 403


def test_the_package_cap_names_the_count(app):
    make_user(app, "alice")
    alice = Api(app, "alice")
    big = "\n".join(f"pkg-{i}==1.0.{i}" for i in range(1001))
    refused = alice.post("/api/profile/dependency-file/import", json={"content": big})
    assert refused.status_code == 422 and "1001 packages" in refused.json()["detail"]
    ok = alice.post("/api/profile/dependency-file/import", json={"content": "\n".join(big.splitlines()[:1000])})
    assert ok.status_code == 200 and len(ok.json()["packages"]) == 1000
    more = alice.post("/api/profile/dependency-file/import", json={"content": "extra==1.0.0\n"})
    assert more.status_code == 422 and "1001 packages" in more.json()["detail"]


def test_a_long_package_list_reaches_the_model_as_counts(app, scripted):
    from rampart.profile.service import PackageRef, ProfileView, profile_block

    many = [PackageRef("PyPI", f"p{i}", "1.0") for i in range(40)] + [PackageRef("npm", "x", None)]
    block = profile_block(ProfileView(exists=True, packages=many))
    assert "41 (40 PyPI, 1 npm); 40 with an exact version" in block and "check_dependencies" in block
    assert "p39" not in block
    few = profile_block(ProfileView(exists=True, packages=many[:3]))
    assert "- PyPI p0 1.0" in few


def _osv_batch(calls: list):
    """A mock OSV.dev for the batch query and the vulnerability records."""

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path))
        if request.url.path == "/v1/querybatch":
            queries = json.loads(request.content)["queries"]
            results = []
            for q in queries:
                if q["package"]["name"] == "lodash":
                    results.append({"vulns": [{"id": "GHSA-p6mc-m468-83gw"}, {"id": "GHSA-x5rq-j2xg-h7qm"}]})
                else:
                    results.append({})
            return httpx.Response(200, json={"results": results})
        vuln_id = request.url.path.rsplit("/", 1)[-1]
        severity = "HIGH" if vuln_id.startswith("GHSA-p6") else "MODERATE"
        return httpx.Response(200, json={
            "id": vuln_id, "summary": f"Prototype pollution {vuln_id}",
            "database_specific": {"severity": severity},
            "affected": [{"package": {"name": "lodash"}, "ranges": [{"events": [{"introduced": "0"}, {"fixed": "4.17.19"}]}],
                          "versions": [f"4.0.{i}" for i in range(500)]}],
        })

    return httpx.MockTransport(handler)


def test_check_dependencies_checks_the_profile_in_one_batch(app, scripted):
    """P6-A29: pinned packages go to OSV.dev in one batch, unpinned ones are listed as not checked,
    results are sorted by severity, cached per vulnerability, and land in the Report."""
    make_user(app, "alice")
    alice = Api(app, "alice")
    alice.put("/api/profile", json={"stack": "", "packages": [
        {"ecosystem": "npm", "name": "lodash", "version": "4.17.15"},
        {"ecosystem": "npm", "name": "react", "version": "18.2.0"},
        {"ecosystem": "PyPI", "name": "fastapi", "version": None},
    ]})
    calls: list = []
    app.state.osv.transport = _osv_batch(calls)
    scripted.replies = [tool_call("check_dependencies", {}, "d1"), "lodash has two known issues."]
    cid = alice.new_conversation()["id"]
    events = alice.send(cid, "Check all my dependencies")
    result = by_name(events, "tool_result")[0]
    assert result["status"] == "ok" and result["provenance"] == "API"
    assert result["summary"] == "2 known vulnerabilities in 1 of 2 checked packages"
    assert [c for c in calls if c[1] == "/v1/querybatch"] == [("POST", "/v1/querybatch")]  # one batch
    model_text = [m for m in scripted.calls[-1] if type(m).__name__ == "ToolMessage"][-1].content
    assert model_text.index("GHSA-p6mc") < model_text.index("GHSA-x5rq")  # HIGH before MODERATE
    assert "Not checked, no exact version: 1 (PyPI fastapi)" in model_text
    stored = records(app, tool="check_dependencies")[-1]["result"]
    assert stored["checked"] == 2 and stored["not_checked"] == 1 and stored["rows"][0]["fixed"] == ["4.17.19"]

    # A second check reads the vulnerability records from the cache.
    calls.clear()
    scripted.replies = [tool_call("check_dependencies", {"ecosystem": "npm"}, "d2"), "Same as before."]
    scripted.reply_index = 0
    alice.send(alice.new_conversation()["id"], "Check my npm packages again")
    assert [c[1] for c in calls] == ["/v1/querybatch"]

    scripted.replies = [tool_call("generate_report", {}, "r1"), "Here is the report."]
    scripted.reply_index = 0
    alice.send(cid, "Write a report")
    report_id = records(app, tool="generate_report")[-1]["result"]["report_id"]
    markdown = alice.get(f"/api/reports/{report_id}").json()["markdown"]
    assert "Dependency check of the Project Profile" in markdown and "GHSA-p6mc-m468-83gw" in markdown


def test_check_dependencies_counts_a_vulnerability_once_whatever_its_advisory_ids(app, scripted):
    """A package whose one vulnerability OSV.dev lists as GHSA and PYSEC gets one row, named by
    the GitHub advisory, with the other ids as aliases."""
    make_user(app, "alice")
    alice = Api(app, "alice")
    alice.put("/api/profile", json={"stack": "", "packages": [
        {"ecosystem": "PyPI", "name": "pyyaml", "version": "5.3.1"},
    ]})
    advisories = {
        "GHSA-8q59-q68h-6hv4": {"id": "GHSA-8q59-q68h-6hv4", "aliases": ["CVE-2020-14343"],
                                "summary": "Improper Input Validation in PyYAML",
                                "database_specific": {"severity": "CRITICAL"},
                                "affected": [{"package": {"name": "PyYAML"}, "ranges": [{"events": [{"fixed": "5.4"}]}]}]},
        "PYSEC-2021-142": {"id": "PYSEC-2021-142", "aliases": ["CVE-2020-14343", "GHSA-8q59-q68h-6hv4"],
                           "details": "A vulnerability in PyYAML's full_load.",
                           "affected": [{"package": {"name": "pyyaml"}, "ranges": [{"events": [{"fixed": "5.4"}]}]}]},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/querybatch":
            return httpx.Response(200, json={"results": [{"vulns": [{"id": i} for i in advisories]}]})
        return httpx.Response(200, json=advisories[request.url.path.rsplit("/", 1)[-1]])

    app.state.osv.transport = httpx.MockTransport(handler)
    scripted.replies = [tool_call("check_dependencies", {}, "d1"), "One critical issue."]
    events = alice.send(alice.new_conversation()["id"], "Check my dependencies")
    assert by_name(events, "tool_result")[0]["summary"] == "1 known vulnerabilities in 1 of 1 checked packages"
    stored = records(app, tool="check_dependencies")[-1]["result"]
    assert stored["vulnerabilities"] == 1 and stored["by_severity"] == {"CRITICAL": 1}
    row = stored["rows"][0]
    assert row["id"] == "GHSA-8q59-q68h-6hv4" and row["aliases"] == ["CVE-2020-14343", "PYSEC-2021-142"]
    model_text = [m for m in scripted.calls[-1] if type(m).__name__ == "ToolMessage"][-1].content
    assert "GHSA-8q59-q68h-6hv4 (CVE-2020-14343)" in model_text and "PYSEC-2021-142" not in model_text


def test_check_dependencies_without_versions_or_osv(app, scripted):
    make_user(app, "alice")
    alice = Api(app, "alice")
    scripted.replies = [tool_call("check_dependencies", {}, "d1"), "Nothing to check."]
    events = alice.send(alice.new_conversation()["id"], "Check my dependencies")
    assert by_name(events, "tool_result")[0]["status"] == "error"
    alice.put("/api/profile", json={"stack": "", "packages": [{"ecosystem": "npm", "name": "lodash", "version": "4.17.15"}]})
    app.state.osv.transport = httpx.MockTransport(lambda request: httpx.Response(503))
    scripted.replies = [tool_call("check_dependencies", {}, "d2"), "OSV is down."]
    scripted.reply_index = 0
    events = alice.send(alice.new_conversation()["id"], "Check my dependencies")
    result = by_name(events, "tool_result")[0]
    assert result["status"] == "error" and "OSV.dev unreachable" in result["summary"]
