from ddgs import DDGS

def duckduckgo_search(query: str):
    with DDGS() as ddgs:
        response = list(ddgs.text(query, max_results=5))
    results = []

    for i, r in enumerate(response, 1):
        title = r.get("title", "Unknown")
        url = r.get("href", "") # DDGS uses 'href' for the URL
        snippet = r.get("body", "").strip() # DDGS uses 'body' for the content

        # Keep only the first 300 characters to avoid wall-of-text
        if len(snippet) > 300:
            snippet = snippet[:300].rsplit(" ", 1)[0] + "..."

        results.append(f"{i}. **{title}**\n     {url}\n {snippet}")
    return results