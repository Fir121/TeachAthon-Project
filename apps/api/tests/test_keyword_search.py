import pytest
from sqlalchemy import select
from app.models import Resource, SourceChunk
from app.ai.keywords import keyword_match
from app.ai.retrieval import OpenAIEmbeddings
from test_classroom import room


@pytest.mark.parametrize(
    "query,text,expected",
    [
        ("recursion", "Recursion reduces a problem to smaller instances.", True),
        ("AI", "AI is used in local optical character recognition.", True),
        ("sorting", "Sorted values make binary search possible.", True),
        ("binary search interval", "Binary search over a sorted interval.", True),
        ("binary search interval", "Binary trees store child nodes.", False),
        ("binary search sorted interval", "Binary search visits nodes in a tree.", False),
        ("recursion", "A discussion of recursive function calls.", True),
        ("C++", "C++ templates support generic programming.", True),
        ("C++", "C pointers reference memory addresses.", False),
        ("binary search", "Binary " + "unrelated " * 100 + "search.", False),
    ],
)
def test_keyword_precision_and_inflections(query, text, expected):
    assert (keyword_match(query, text, "") is not None) == expected


def test_keyword_results_reject_partial_hits_and_do_not_call_embeddings(room, monkeypatch):
    teacher, student, outsider, factory, cid, _, _, _ = room
    with factory() as db:
        resource = db.scalar(select(Resource).where(Resource.course_id == cid))
        db.add_all(
            [
                SourceChunk(
                    course_id=cid,
                    resource_id=resource.id,
                    source_type="resource",
                    title="old title",
                    text="Binary search over a sorted interval.",
                    page_number=1,
                ),
                SourceChunk(
                    course_id=cid,
                    resource_id=resource.id,
                    source_type="resource",
                    title="old title",
                    text="Binary trees use nodes.",
                    page_number=2,
                ),
                SourceChunk(
                    course_id=cid,
                    resource_id=resource.id,
                    source_type="resource",
                    title="old title",
                    text="Recursion simplifies recursive function calls and AI applications.",
                    page_number=3,
                ),
            ]
        )
        db.commit()

    async def forbidden(*args, **kwargs):
        raise AssertionError("Keyword search must not call a semantic provider")

    from app.config import settings

    monkeypatch.setattr(settings(), "openai_api_key", "test-only-no-real-key")
    monkeypatch.setattr(OpenAIEmbeddings, "embed", forbidden)
    result = student.get(f"/api/v1/courses/{cid}/search", params={"q": "binary search sorted interval"}).json()
    assert len(result["matches"]) == 1
    assert [location["page_number"] for location in result["matches"][0]["locations"]] == [1]
    for term in ["recursion", "recursive", "AI"]:
        result = student.get(f"/api/v1/courses/{cid}/search", params={"q": term}).json()
        assert result["matches"][0]["locations"][0]["page_number"] == 3
        assert result["warnings"] == []
    # Match renamed files immediately, without claiming the title names a particular page.
    with factory() as db:
        db.get(Resource, resource.id).original_filename = "Lecture on Algebra.pdf"
        db.commit()
    result = student.get(f"/api/v1/courses/{cid}/search", params={"q": "algebra"}).json()
    assert result["matches"][0]["locations"] == []
    assert result["matches"][0]["url"] == f"/resources/{resource.id}"
    assert outsider.get(f"/api/v1/courses/{cid}/search", params={"q": "algebra"}).status_code == 404
