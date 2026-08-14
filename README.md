# GuzoAI ✈️

A multi-agent AI travel planner that takes natural language input and generates personalized travel itineraries — including flights, hotels, activities, and local attractions.

Built with **LangGraph**, **LangChain**, **Groq**, and **FastAPI**.
![Diagram](media/without_MCP.jpeg)
## Agents

| Agent | Role |
|---|---|
| Flight Agent | Finds live flight data based on route and travel dates using AviationStack API |
| Hotel Agent | Recommends accommodations based on budget and preferences |
| Itinerary Agent | Builds a day-by-day travel plan with activities and sightseeing |
| Final Response Agent | Compiles all agent outputs into a cohesive travel plan |

Each agent shares a common **State** stored in PostgreSQL, which acts as persistent memory across the session. State fields: `user_query`, `flight_results`, `hotel_results`, `itinerary`, `final_response`, `messages`.

## Tech Stack

- [LangGraph](https://github.com/langchain-ai/langgraph) — multi-agent workflow orchestration
- [LangChain + Groq](https://python.langchain.com/) — LLM integration
- [AviationStack API](https://aviationstack.com/) — live flight data
- [DuckDuckGo Search](https://pypi.org/project/ddgs/) — web search tool
- [PostgreSQL](https://www.postgresql.org/) — persistent agent memory
- [FastAPI](https://fastapi.tiangolo.com/) — web server

## License

[MIT](LICENSE)
