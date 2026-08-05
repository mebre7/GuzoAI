from tools.search_tool import duckduckgo_search
from tools.flight_tool import search_flights

# results = duckduckgo_search("What are best hotels in Addis Ababa?")
# for result in results:
#     print(result)
# "Plan a 7 days Japan trip from Bangladesh"
result = search_flights("Plan a 7 days Japan trip from Ethiopia")
print(result)