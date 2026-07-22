# **Music League Stats: Architecture & Script Summary**

This project processes Music League export data (a collection of CSV files containing competitors, rounds, submissions, and votes) into a local DuckDB database. It then enriches that data via Spotify and Last.fm APIs and serves a dashboard using Streamlit.

Here is a breakdown of what the scripts do, categorized by their role in the pipeline, with structural snippets you can use to build an AI agent prompt.

## **1\. Data Ingestion & Enrichment (builddb.py, builddbs1.py, builddbs2.py)**

These scripts are responsible for the Extract, Transform, Load (ETL) process. builddb.py is the main workhorse.

**Key responsibilities:**

1. **Unzipping:** Extracts the raw .csv files from the downloaded export.zip.  
2. **Database Creation:** Uses DuckDB's incredibly fast read\_csv function to create tables dynamically based on the CSV headers.  
3. **Data Enrichment (API Calls):** Connects to the Spotify (spotipy) and Last.fm (pylast) APIs to fetch genres and track lengths for each submitted song using the Spotify URI.  
4. **Resilience:** Implements a custom @retry\_api\_call decorator to handle rate limits and API timeouts during enrichment.

**Core Snippet (DuckDB CSV Ingestion):**

import duckdb  
import zipfile

\# 1\. Unzip  
with zipfile.ZipFile('export.zip', 'r') as zip\_ref:  
    zip\_ref.extractall('data/')

\# 2\. Load into DuckDB  
con \= duckdb.connect(database='bwi.duckdb')  
for file in \['competitors.csv', 'rounds.csv', 'submissions.csv', 'votes.csv'\]:  
    table\_name \= file.replace('.csv', '')  
    query \= f"CREATE OR REPLACE TABLE {table\_name} AS SELECT \* FROM read\_csv('data/{file}')"  
    con.execute(query)

## **2\. The Dashboard Entry Point (main.py)**

Streamlit uses a multi-page app structure. main.py simply defines the navigation and wires up all the individual analysis scripts.

**Core Snippet:**

import streamlit as st

st.title("🎵Brian Wilson Invitational Stats")  
pg \= st.navigation(\[  
    "leaderboard.py",  
    "song\_popularity.py",  
    "genres.py",  
    \# ... other pages  
\])  
pg.run()

## **3\. Data Analysis & Visualization Scripts (The "Views")**

The rest of the python files are Streamlit "pages". They all follow a standardized pattern:

1. Connect to the DuckDB database (read-only implicitly or explicitly).  
2. Write a complex SQL CTE (Common Table Expression) to aggregate the data.  
3. Convert the SQL result to a Pandas DataFrame using .df().  
4. Render the DataFrame using Streamlit native tables (st.table), metrics (st.metric), or visualization libraries (Seaborn, Matplotlib, Plotly).

Here are how the views are categorized:

### **A. Leaderboards & Standings**

Files: leaderboard.py, song\_popularity.py, song\_unpopularity.py, artist\_popularity.py, artist\_unpopularity.py, meh\_songs.py

* **Pattern:** Simple SQL aggregations (SUM, COUNT) combined with GROUP BY and ORDER BY.

**Canonical Snippet (leaderboard.py):**

import streamlit as st  
import duckdb

con \= duckdb.connect(database='bwi.duckdb')  
st.subheader("Leaderboard")

query \= """  
SELECT Name, SUM(v."Points Assigned")::INTEGER as points  
FROM competitors c  
JOIN submissions s ON c.ID \= s."Submitter ID"  
JOIN votes v ON s."Spotify URI" \= v."Spotify URI"  
GROUP BY Name  
ORDER BY points DESC;  
"""  
df \= con.execute(query).df()  
df.index \+= 1 \# 1-based indexing for the UI table  
st.table(df)

### **B. Matrix / Heatmap Analyses**

Files: point\_breakdown\_heatmap.py, vote\_breakdown\_heatmap.py

* **Pattern:** SQL retrieves relationships (e.g., Voter vs. Submitter). Pandas pivot\_table reshapes the data into a 2D matrix. Seaborn renders it.

**Canonical Snippet (vote\_breakdown\_heatmap.py):**

\# ... SQL to get voter, submitter, and total points ...  
df \= con.execute(query).df()

\# Reshape data for heatmap  
points\_matrix \= df.pivot\_table(index='voter', columns='submitter', values='points', aggfunc='sum', fill\_value=0)

plt.figure(figsize=(20, 12))  
sns.heatmap(points\_matrix, annot=True, cmap='viridis', fmt='g')  
st.pyplot(plt)

### **C. Advanced & Interactive Charts**

Files: genres.py, voting\_by\_playlist\_position.py, cros\_season\_voting\_by\_playlist\_position.py

* **Pattern:** Uses interactive Streamlit widgets (st.selectbox, st.slider) to pass parameters (?) into DuckDB SQL queries. Uses Plotly (px.line\_polar) or Seaborn (sns.lmplot) for advanced visuals.  
* *Note on genres.py:* Uses DuckDB's advanced list/array handling (flatten, UNNEST) to deal with the genre arrays fetched from Spotify.

### **D. Natural Language / Comments**

Files: wordclouds.py

* **Pattern:** Uses DuckDB's regex functions (REGEXP\_SPLIT\_TO\_ARRAY, regexp\_replace) to strip punctuation and tokenize comments, then generates a visual using the wordcloud library.

### **E. Individualized "Wrapped" Stats**

Files: bit\_of\_fun.py, votes\_given.py

* **Pattern:** Highly interactive. The user selects a competitor, and the script runs multiple contextual queries (e.g., "How often you upvoted the winning song") and displays them using st.metric(). Uses MAX\_BY and MIN\_BY in DuckDB to find winners/losers per round efficiently.

## **4\. Shell Scripts (The Glue)**

Simple wrappers around the uv package manager to ensure scripts are run in the correct virtual environment.

* builddb.sh: Runs the database ingestion.  
* streamlit.sh: Runs the dashboard.  
* db\_ui.sh: Opens the DuckDB CLI with the UI database attached for manual SQL testing.

## **Prompting Guide for an AI Agent**

If you want an AI agent to build a similar project or add features to this one, feed it the following instructions along with your specific feature request:

**System Prompt / Instructions for AI Agent:**

We are building a local analytics dashboard for a Music League.

**Tech Stack:**

* **Package Manager:** uv  
* **Database:** duckdb (Local .duckdb files)  
* **UI:** streamlit  
* **Data Manipulation:** pandas  
* **Visualization:** seaborn, matplotlib, plotly

**Data Schema (Inferred from CSVs):**

* competitors(ID, Name)  
* rounds(ID, Created, Name, Description, Playlist URL)  
* submissions(Spotify URI, Title, Album, Artist(s), Submitter ID, Created, Comment, Round ID, Visible To Voters, spotify\_genres, lastfm\_genres, track\_length\_seconds)  
* votes(Voter ID, Spotify URI, Round ID, Points Assigned, Comment)

**Coding Standards:**

1. Use DuckDB to do the heavy lifting for aggregations and joins using standard SQL. Use CTEs for complex multi-step aggregations.  
2. Always fetch DuckDB results as Pandas DataFrames (.df()).  
3. Use Streamlit multi-page architecture (st.navigation).  
4. For query parameters driven by UI (like Dropdowns), use parameterized queries (con.execute(query, \[param\])) to prevent injection and simplify formatting.  
5. For visual plots, prefer Seaborn or Plotly, and render them using st.pyplot() or st.plotly\_chart().