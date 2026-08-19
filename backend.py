import operator
import os
import uuid
from threading import Lock
from typing import Annotated, TypedDict

import certifi
import psycopg
from dotenv import load_dotenv
from langchain_core.messages import AIMessage, AnyMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_groq import ChatGroq
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.graph import END, START, StateGraph
from pydantic import SecretStr
from psycopg.rows import dict_row

from tools.flight_tool import search_flights
from tools.search_tool import duckduckgo_search

load_dotenv()
os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()


class TravelState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    user_query: str
    flight_results: str
    hotel_results: str
    itinerary: str
    final_response: str
    llm_calls: int


_llm = None
_travel_graph = None
_resource_lock = Lock()


def get_database_url() -> str:
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise ValueError("DATABASE_URL is not configured")
    if "sslmode" not in db_url:
        separator = "&" if "?" in db_url else "?"
        db_url = f"{db_url}{separator}sslmode=require"
    return db_url


def get_llm() -> ChatGroq:
    global _llm
    if _llm is None:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise ValueError("GROQ_API_KEY is not configured")
        _llm = ChatGroq(
            model=os.getenv("GROQ_MODEL") or "openai/gpt-oss-120b",
            api_key=SecretStr(api_key),
        )
    return _llm


def flight_agent(state: TravelState):
    return {
        "flight_results": search_flights(state.get("user_query", "")),
        "messages": [AIMessage(content="Flight search fetched successfully.")],
        "llm_calls": state.get("llm_calls", 0),
    }


def hotel_agent(state: TravelState):
    query = f"Best hotels for {state.get('user_query', '')}"
    return {
        "hotel_results": duckduckgo_search(query),
        "messages": [AIMessage(content="Hotel search fetched successfully.")],
        "llm_calls": state.get("llm_calls", 0),
    }


def itinerary_agent(state: TravelState):
    prompt = f"""
    You are a travel assistant. Create a complete travel itinerary.
    User Query: {state.get('user_query', '<missing>')}
    Flight Results: {state.get('flight_results', '<missing>')}
    Hotel Results: {state.get('hotel_results', '<missing>')}
    Make the itinerary practical, budget-aware, and easy to follow.
    """
    response = get_llm().invoke([
        SystemMessage(content="You are an expert travel planner."),
        HumanMessage(content=prompt),
    ])
    itinerary = response.content if response else "No itinerary generated."
    return {
        "itinerary": itinerary,
        "messages": [response] if response else [],
        "llm_calls": state.get("llm_calls", 0) + 1,
    }


def final_response_agent(state: TravelState):
    final_prompt = f"""
    Generate the final travel response for the user.
    User Request: {state.get('user_query', '<missing>')}
    Flights: {state.get('flight_results', '<missing>')}
    Hotels: {state.get('hotel_results', '<missing>')}
    Itinerary: {state.get('itinerary', '<missing>')}

    Format the answer using these sections:
    1. Summary of the trip
    2. Flight details or information
    3. Hotel suggestions
    4. Day-by-Day Itinerary
    5. Estimated Budget
    6. Final Recommendations

    Mention that live flight data may not include ticket prices.
    """
    response = get_llm().invoke([
        SystemMessage(content="You are a professional AI travel booking assistant."),
        HumanMessage(content=final_prompt),
    ])
    final_response = response.content if response else "No response generated."
    return {
        "messages": [response] if response else [],
        "final_response": final_response,
        "llm_calls": state.get("llm_calls", 0) + 1,
    }


def get_travel_graph():
    """Create external resources only when an actual travel request arrives."""
    global _travel_graph
    if _travel_graph is None:
        with _resource_lock:
            if _travel_graph is None:
                graph = StateGraph(TravelState)
                graph.add_node("flight_agent", flight_agent)
                graph.add_node("hotel_agent", hotel_agent)
                graph.add_node("itinerary_agent", itinerary_agent)
                graph.add_node("final_response_agent", final_response_agent)
                graph.add_edge(START, "flight_agent")
                graph.add_edge("flight_agent", "hotel_agent")
                graph.add_edge("hotel_agent", "itinerary_agent")
                graph.add_edge("itinerary_agent", "final_response_agent")
                graph.add_edge("final_response_agent", END)

                conn = psycopg.connect(
                    get_database_url(), autocommit=True, row_factory=dict_row
                )
                checkpoint_saver = PostgresSaver(conn=conn)
                checkpoint_saver.setup()
                _travel_graph = graph.compile(checkpointer=checkpoint_saver)
    return _travel_graph


def run_travel_planner(user_input: str, thread_id: str | None = None):
    thread_id = thread_id or f"user_{uuid.uuid4().hex}"
    config = RunnableConfig(configurable={"thread_id": thread_id})
    result = get_travel_graph().invoke(
        {
            "messages": [HumanMessage(content=user_input)],
            "user_query": user_input,
            "flight_results": "",
            "hotel_results": "",
            "itinerary": "",
            "final_response": "",
            "llm_calls": 0,
        },
        config=config,
    )
    final_answer = result["messages"][-1].content if result.get("messages") else "No response generated."
    return {
        "thread_id": thread_id,
        "answer": result.get("final_response") or final_answer,
        "flight_results": result.get("flight_results", ""),
        "hotel_results": result.get("hotel_results", ""),
        "itinerary": result.get("itinerary", ""),
        "final_response": result.get("final_response", ""),
        "llm_calls": result.get("llm_calls", 0),
    }
