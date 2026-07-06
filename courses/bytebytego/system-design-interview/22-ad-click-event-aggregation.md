---
title: 22. Ad Click Event Aggregation
---

import { ConversationDialog } from "/snippets/ConversationDialog.jsx";
import { FootnoteRef, Footnotes, Footnote } from "/snippets/Footnote.jsx";

With the rise of Facebook, YouTube, TikTok, and the online media economy, digital advertising is taking an ever-bigger share of the total advertising spending. As a result, tracking ad click events is very important. In this chapter, we explore how to design an ad click event aggregation system at Facebook or Google scale.

Before we dive into technical design, let's learn about the core concepts of online advertising to better understand this topic. One core benefit of online advertising is its measurability, as quantified by real-time data.

Digital advertising has a core process called Real-Time Bidding (RTB), in which digital advertising inventory is bought and sold. Figure 1 shows how the online advertising process works.

<Frame caption="Figure 1 RTB advertising process">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-1-rtb-process-5E2OUEKS.svg"
    alt="Image represents a simplified diagram of the programmatic advertising ecosystem, showing the flow of information between key players on the demand and supply sides. On the left, labeled 'Demand Side', an Advertiser initiates the process. The Advertiser interacts with a Demand-Side Platform (DSP), labeled '(Demand Side Platform)', which facilitates the buying of ad inventory. The DSP then sends ad requests to an Ad Exchange, a central marketplace where ad inventory is traded. On the right, labeled 'Supply Side', a Publisher offers ad inventory. The Publisher connects to a Supply-Side Platform (SSP), labeled '(Supply Side Platform)', which manages the selling of this inventory. The SSP sends ad inventory offers to the Ad Exchange. The Ad Exchange acts as the central hub, matching ad requests from the DSP with ad inventory offers from the SSP, ultimately determining which ads are displayed to users. Arrows indicate the direction of information flow, showing the communication between each component."
    width={600}
  />
</Frame>

The speed of the RTB process is important as it usually occurs in less than a second.

Data accuracy is also very important. Ad click event aggregation plays a critical role in measuring the effectiveness of online advertising, which essentially impacts how much money advertisers pay. Based on the click aggregation results, campaign managers can control the budget or adjust bidding strategies, such as changing targeted audience groups, keywords, etc. The key metrics used in online advertising, including click-through rate (CTR) <FootnoteRef id="1" /> and conversion rate (CVR) <FootnoteRef id="2" />, depend on aggregated ad click data.

## Step 1 - Understand the Problem and Establish Design Scope

The following set of questions helps to clarify requirements and narrow down the scope.

<ConversationDialog
  messages={[
    {
      speaker: "Candidate",
      align: "right",
      text: "What is the format of the input data?",
    },
    {
      speaker: "Interviewer",
      align: "left",
      text: "It's a log file located in different servers and the latest click events are appended to the end of the log file. The event has the following attributes: *ad_id, click_timestamp, user_id, ip,* and *country*.",
    },
    {
      speaker: "Candidate",
      align: "right",
      text: "What's the data volume?",
    },
    {
      speaker: "Interviewer",
      align: "left",
      text: "1 billion ad clicks per day and 2 million ads in total. The number of ad click events grows 30% year-over-year.",
    },
    {
      speaker: "Candidate",
      align: "right",
      text: "What are some of the most important queries to support?",
    },
    {
      speaker: "Interviewer",
      align: "left",
      text: "The system needs to support the following 3 queries:<ul><li>Return the number of click events for a particular ad in the last *M* minutes.</li><li>Return the top 100 most clicked ads in the past 1 minute. Both parameters should be configurable. Aggregation occurs every minute.</li><li>Support data filtering by *ip*, *user_id,* or *country* for the above two queries.</li></ul>",
    },
    {
      speaker: "Candidate",
      align: "right",
      text: "Do we need to worry about edge cases? I can think of the following:<ul><li>There might be events that arrive later than expected.</li><li>There might be duplicated events.</li><li>Different parts of the system might be down at any time, so we need to consider system recovery.</li></ul>",
    },
    {
      speaker: "Interviewer",
      align: "left",
      text: "That's a good list. Yes, take these into consideration.",
    },
    {
      speaker: "Candidate",
      align: "right",
      text: "What is the latency requirement?",
    },
    {
      speaker: "Interviewer",
      align: "left",
      text: "A few minutes of end-to-end latency. Note that latency requirements for RTB and ad click aggregation are very different. While latency for RTB is usually less than one second due to the responsiveness requirement, a few minutes of latency is acceptable for ad click event aggregation because it is primarily used for ad billing and reporting.",
    },
  ]}
/>

With the information gathered above, we have both functional and non-functional requirements.

### Functional Requirements

- Aggregate the number of clicks of *ad_id* in the last *M* minutes.
- Return the top 100 most clicked *ad_id* every minute.
- Support aggregation filtering by different attributes.
- Dataset volume is at Facebook or Google scale (see the back-of-envelope estimation section below for detailed system scale requirements).

### Non-functional Requirements

- Correctness of the aggregation result is important as the data is used for RTB and ads billing.
- Properly handle delayed or duplicate events.
- Robustness. The system should be resilient to partial failures.
- Latency requirement. End-to-end latency should be a few minutes, at most.

### Back-of-the-envelope Estimation

Let's do an [back-of-the-envelope estimation](./03-back-of-the-envelope-estimation) to understand the scale of the system and the potential challenges we will need to address.

- 1 billion DAU.
- Assume on average each user clicks 1 ad per day. That's 1 billion ad click events per day.
- Ad click QPS = 10^9 events / 10^5 seconds in a day = 10,000
- Assume peak ad click QPS is 5 times the average number. Peak QPS = 50,000 QPS.
- Assume a single ad click event occupies 0.1 KB storage. Daily storage requirement is: 0.1 KB \* 1 billion = 100 GB. The monthly storage requirement is about 3 TB.

## Step 2 - Propose High-Level Design and Get Buy-In

In this section, we discuss query API design, data model, and high-level design.

### Query API Design

The purpose of the API design is to have an agreement between the client and the server. In a consumer app, a client is usually the end-user who uses the product. In our case, however, a client is the dashboard user (data scientist, product manager, advertiser, etc.) who runs queries against the aggregation service.

Let's review the functional requirements so we can better design the APIs:

- Aggregate the number of clicks of *ad_id* in the last *M* minutes.
- Return the top *N* most clicked *ad_ids* in the last *M* minute.
- Support aggregation filtering by different attributes.

We only need two APIs to support those three use cases because filtering (the last requirement) can be supported by adding query parameters to the requests.

**API 1: Aggregate the number of clicks of *ad_id* in the last *M* minutes.**

*Table 1 Aggregated count API*

| **API**                                 | **Detail**                                      |
| --------------------------------------- | ----------------------------------------------- |
| GET /v1/ads/\{:ad_id\}/aggregated_count | Return aggregated event count for a given ad_id |

Request parameters are:

*Table 2 Aggregated count request parameters*

| **Field** | **Description**                                                                                       | **Type** |
| --------- | ----------------------------------------------------------------------------------------------------- | -------- |
| from      | Start minute (default is now minus 1 minute)                                                          | long     |
| to        | End minute (default is now)                                                                           | long     |
| filter    | An identifier for different filtering strategies. For example, filter = 001 filters out non-US clicks | long     |

Response:

*Table 3 Aggregated count response*

| **Field** | **Description**                                        | **Type** |
| --------- | ------------------------------------------------------ | -------- |
| ad_id     | The identifier of the ad                               | string   |
| count     | The aggregated count between the start and end minutes | long     |

**API 2: Return top *N* most clicked *ad_ids* in the last *M* minutes**

*Table 4 Popular ads API*

| **API**                 | **Detail**                                              |
| ----------------------- | ------------------------------------------------------- |
| GET /v1/ads/popular_ads | Return top *N* most clicked ads in the last *M* minutes |

Request parameters are:

*Table 5 Popular ads request parameters*

| **Field** | **Description**                                  | **Type** |
| --------- | ------------------------------------------------ | -------- |
| count     | Top *N* most clicked ads                         | integer  |
| window    | The aggregation window size (*M*) in minutes     | integer  |
| filter    | An identifier for different filtering strategies | long     |

Response:

*Table 6 Popular ads response*

| **Field** | **Description**                | **Type** |
| --------- | ------------------------------ | -------- |
| ad_ids    | A list of the most clicked ads | array    |

### Data Model

There are two types of data in the system: raw data and aggregated data.

#### Raw Data

Below shows what the raw data looks like in log files:

```txt
[AdClickEvent] ad001, 2021-01-01 00:00:01, user 1, 207.148.22.22, USA
```

Table 7 lists what the data fields look like in a structured way. Data is scattered on different application servers.

*Table 7 Raw data structure*

| **ad_id** | **click_timestamp** | **user** | **ip**        | **country** |
| --------- | ------------------- | -------- | ------------- | ----------- |
| ad001     | 2021-01-01 00:00:01 | user1    | 207.148.22.22 | USA         |
| ad001     | 2021-01-01 00:00:02 | user1    | 207.148.22.22 | USA         |
| ad002     | 2021-01-01 00:00:02 | user2    | 209.153.56.11 | USA         |

#### Aggregated Data

Assume that ad click events are aggregated every minute. Table 8 shows the aggregated result.

*Table 8 Aggregated data per minute*

| ad_id | click_minute | count |
| ----- | ------------ | ----- |
| ad001 | 202101010000 | 5     |
| ad001 | 202101010001 | 7     |

To support ad filtering, we add an additional field called *filter_id* to the table. Records with the same *ad_id* and *click_minute* are grouped by *filter_id* as shown in Table 9, and filters are defined in Table 10.

*Table 9 Aggregated data with filter id*

| ad_id | click_minute | filter_id | count |
| ----- | ------------ | --------- | ----- |
| ad001 | 202101010000 | *0012*    | 2     |
| ad001 | 202101010000 | *0023*    | 3     |
| ad001 | 202101010001 | *0012*    | 1     |
| ad001 | 202101010001 | *0023*    | 6     |

*Table 10 Filter definitions*

| filter_id | region | IP        | user_id |
| --------- | ------ | --------- | ------- |
| 0012      | US     | \*        | \*      |
| 0013      | \*     | 123.1.2.3 | \*      |

To support the query to return the top *N* most clicked ads in the last *M* minutes, the following structure is used.

*Table 11 Most clicked ads structure*

| **most_clicked_ads** |           |                                                  |
| -------------------- | --------- | ------------------------------------------------ |
| window_size          | integer   | The aggregation window size (*M*) in minutes     |
| update_time_minute   | timestamp | Last updated timestamp (in 1-minute granularity) |
| most_clicked_ads     | array     | List of ad IDs in JSON format                    |

#### Comparison

The comparison between storing raw data and aggregated data is shown below:

*Table 12 Raw vs aggregated data comparison*

|          | **Raw data only**                                                   | **Aggregated data only**                                                                  |
| -------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Pros** | - Full data set<br /> <br />- Support data filter and recalculation | - Smaller data set<br /> <br />- Fast query                                               |
| **Cons** | - Huge data storage<br /> <br />- Slow query                        | - Data loss. This is derived data. For example, 10 entries might be aggregated to 1 entry |

Should we store raw data or aggregated data? Our recommendation is to store both. Let's take a look at why.

- It's a good idea to keep the raw data. If something goes wrong, we could use the raw data for debugging. If the aggregated data is corrupted due to a bad bug, we can recalculate the aggregated data from the raw data, after the bug is fixed.
- Aggregated data should be stored as well. The data size of the raw data is huge. The large size makes querying raw data directly very inefficient. To mitigate this problem, we run read queries on aggregated data.
- Raw data serves as backup data. We usually don't need to query raw data unless recalculation is needed. Old raw data could be moved to cold storage to reduce costs.
- Aggregated data serves as active data. It is tuned for query performance.

#### Choose the Right Database

When it comes to choosing the right database, we need to evaluate the following:

- What does the data look like? Is the data relational? Is it a document or a blob?
- Is the workflow read-heavy, write-heavy, or both?
- Is transaction support needed?
- Do the queries rely on many online analytical processing (OLAP) functions <FootnoteRef id="3" /> like SUM, COUNT?

Let's examine the raw data first. Even though we don't need to query the raw data during normal operations, it is useful for data scientists or machine learning engineers to study user response prediction, behavioral targeting, relevance feedback, etc. <FootnoteRef id="4" />.

As shown in the back of the envelope estimation, the average write QPS is 10,000, and the peak QPS can be 50,000, so the system is write-heavy. On the read side, raw data is used as backup and a source for recalculation, so in theory, the read volume is low.

Relational databases can do the job, but scaling the write can be challenging. NoSQL databases like Cassandra and InfluxDB are more suitable because they are optimized for write and time-range queries.

Another option is to store the data in Amazon S3 using one of the columnar data formats like ORC <FootnoteRef id="5" />, Parquet <FootnoteRef id="6" />, or AVRO <FootnoteRef id="7" />. We could put a cap on the size of each file (say, 10GB) and the stream processor responsible for writing the raw data could handle the file rotation when the size cap is reached. Since this setup may be unfamiliar for many, in this design we use Cassandra as an example.

For aggregated data, it is time-series in nature and the workflow is both read and write heavy. This is because, for each ad, we need to query the database every minute to display the latest aggregation count for customers. This feature is useful for auto-refreshing the dashboard or triggering alerts in a timely manner. Since there are two million ads in total, the workflow is read-heavy. Data is aggregated and written every minute by the aggregation service, so it's write-heavy as well. We could use the same type of database to store both raw data and aggregated data.

Now we have discussed query API design and data model, let's put together the high-level design.

### High-level Design

In real-time big data <FootnoteRef id="8" /> processing, data usually flows into and out of the processing system as unbounded data streams. The aggregation service works in the same way; the input is the raw data (unbounded data streams), and the output is the aggregated results (see Figure 2).

<Frame caption="Figure 2 Aggregation workflow">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-2-aggregation-workflow-ILOBUVRV.svg"
    alt="Image represents a data processing pipeline. The pipeline begins with an 'Input' stage containing a 'Log Watcher' component that pushes data to a 'Data Aggregation Service' in the 'Process' stage. This service aggregates data, calculating and outputting two metrics: 'Ad count' (aggregated every minute) and 'Top 100 most clicked Ads' (also aggregated every minute). These aggregated metrics are then written to a 'Database' in the 'Output' stage. Finally, a 'Query Service' in the 'Display' stage queries the database to retrieve and display the aggregated data. The flow of data is unidirectional, moving from left to right through the stages, with dashed lines separating the distinct stages of Input, Process, Output, and Display."
    width={600}
  />
</Frame>

#### Asynchronous Processing

The design we currently have is synchronous. This is not good because the capacity of producers and consumers is not always equal. Consider the following case; if there is a sudden increase in traffic and the number of events produced is far beyond what consumers can handle, consumers might get out-of-memory errors or experience an unexpected shutdown. If one component in the synchronous link is down, the whole system stops working.

A common solution is to adopt a message queue (Kafka) to decouple producers and consumers. This makes the whole process asynchronous and producers/consumers can be scaled independently.

Putting everything we have discussed together, we come up with the high-level design as shown in Figure 3. Log watcher, aggregation service, and database are decoupled by two message queues. The database writer polls data from the message queue, transforms the data into the database format, and writes it to the database.

<Frame caption="Figure 3 High-level design">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-3-high-level-design-IPIRUMTL.svg"
    alt="Image represents a data processing pipeline for ad click data. A `Log Watcher` feeds data into a `Message Queue`. This queue is consumed by a `Data Aggregation Service`, which performs two aggregations: 'Ad count (Aggregate every min)' and 'Top 100 most clicked Ads (Aggregate every min)'. The results of these aggregations are then sent to a second `Message Queue`. A `Database Writer` consumes this second queue and writes the aggregated data into an `Aggregation database`. Separately, the initial `Message Queue` is also consumed by a `Database Writer` that stores raw data in a `Raw data database`. Finally, a `Query Service (Dashboard)` queries the `Aggregation database` to retrieve and display aggregated results. The arrows indicate the flow of data between components."
    width={600}
  />
</Frame>

What is stored in the first message queue? It contains ad click event data as shown in Table 13.

*Table 13 First message queue data*

| **ad_id** | **click_timestamp** | **user_id** | **ip** | **country** |
| --------- | ------------------- | ----------- | ------ | ----------- |

What is stored in the second message queue? The second message queue contains two types of data:

1. Ad click counts aggregated at per-minute granularity.

    *Table 14 Ad click counts in second queue*

    | **ad_id** | **click_minute** | **count** |
    | --------- | ---------------- | --------- |

2. Top *N* most clicked ads aggregated at per-minute granularity.

    *Table 15 Top N most clicked ads in second queue*

    | **update_time_minute** | **most_clicked_ads** |
    | ---------------------- | -------------------- |

You might be wondering why we don't write the aggregated results to the database directly. The short answer is that we need the second message queue like Kafka to achieve end-to-end exactly-once semantics (atomic commit).

<Frame caption="Figure 4 End-to-end exactly-once">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-4-end-to-end-exactly-once-TJGYUBWJ.svg"
    alt="Image represents a system for data aggregation and reporting. A `Log Watcher` feeds data into a `Message Queue`. This queue is then processed by a `Data Aggregation Service`, which performs two aggregations: 'Ad count' (aggregated every minute) and 'Top 100 most clicked Ads' (also aggregated every minute). These aggregated results are then sent to a second `Message Queue`. The first `Message Queue`'s data is also written to a `Raw data database` via a `Database Writer`. The second `Message Queue`'s data is written to an `Aggregation database` via another `Database Writer`. Finally, a `Query Service` (labeled as a Dashboard) queries the `Aggregation database` to retrieve and display the aggregated data. The entire process within the dashed box is described as an 'Atomic commit', implying that all operations within this section are treated as a single, indivisible transaction."
    width={600}
  />
</Frame>

Next, let's dig into the details of the aggregation service.

#### Aggregation Service

The MapReduce framework is a good option to aggregate ad click events. The directed acyclic graph (DAG) is a good model for it <FootnoteRef id="9" />. The key to the DAG model is to break down the system into small computing units, like the Map/Aggregate/Reduce nodes, as shown in Figure 5 (*e.g., performing aggregation with Java Streams <FootnoteRef id="10" />*).

<Frame caption="Figure 5 Aggregation service">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-5-aggregation-service-EDCFAVGD.svg"
    alt="Image represents two distinct data aggregation service architectures. The top architecture, labeled 'Aggregate every minute', depicts a simple pipeline. Data Input feeds into a 'Map' component, which then sends its output to two separate 'Aggregate' components. Each 'Aggregate' component outputs an 'Ad count'. The entire process is enclosed within a dashed box labeled 'Aggregation Service'. The bottom architecture, labeled 'Top 100 aggregation', shows a more complex MapReduce-like structure. Data Input flows into a 'Map' component, which then feeds into two 'Aggregate' components. These 'Aggregate' components, in turn, feed into a 'Reduce' component, which outputs 'Top 100 Ads'. Similar to the top architecture, this is also contained within a dashed box labeled 'Aggregation Service'. Both diagrams illustrate different approaches to aggregating data, with the top focusing on simple per-minute counts and the bottom aiming to identify the top 100 ads."
    width={500}
  />
</Frame>

Each node is responsible for one single task and it sends the processing result to its downstream nodes.

**Map node**

A Map node reads data from a data source, and then filters and transforms the data. For example, a Map node sends ads with *ad_id % 2 = 0* to node 1, and the other ads go to node 2, as shown in Figure 6.

<Frame caption="Figure 6 Map operation">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-6-map-operation-VBQHMZF6.svg"
    alt="Image represents a simplified data processing pipeline. Data Input feeds into a central 'Map' node. The Map node then routes the data to two different 'Aggregate' nodes based on a condition: if the modulo 2 of the 'ad_id' field is 0, the data is sent to 'Aggregate Node 1'; otherwise (if the modulo 2 of 'ad_id' is 1), the data is sent to 'Aggregate Node 2'. The arrows indicate the direction of data flow, with labels specifying the routing condition ('ad_id %2 = 0' and 'ad_id %2 = 1'). This suggests a system that partitions data based on a specific field ('ad_id') and then performs separate aggregation operations on each partition."
    width={500}
  />
</Frame>

You might be wondering why we need the Map node. An alternative option is to set up Kafka partitions or tags and let the aggregate nodes subscribe to Kafka directly. This works, but the input data may need to be cleaned or normalized, and these operations can be done by the Map node. Another reason is that we may not have control over how data is produced and therefore events with the same *ad_id* might land in different Kafka partitions.

**Aggregate node**

An Aggregate node counts ad click events by *ad_id* in memory every minute. In the MapReduce paradigm, the Aggregate node is part of the Reduce. So the map-aggregate-reduce process really means map-reduce-reduce.

**Reduce node**

A Reduce node reduces aggregated results from all "Aggregate" nodes to the final result. For example, as shown in Figure 7, there are three aggregation nodes and each contains the top 3 most clicked ads within the node. The Reduce node reduces the total number of most clicked ads to 3.

<Frame caption="Figure 7 Reduce node">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-7-reduce-node-7MQQ64OQ.svg"
    alt="Image represents a data processing pipeline for finding the top 3 most clicked ads in the last minute. The pipeline begins with an 'Aggregate' stage showing three boxes, each containing ad IDs and their click counts. The first box contains 'ad1: 12', 'ad3: 5', 'ad2: 3'; the second box contains 'ad7: 9', 'ad10: 4', 'ad8: 3'; and the third box contains 'ad13: 8', 'ad11: 4', 'ad15: 3'. Arrows connect these boxes to a 'Reduce' stage, which combines the data. The 'Reduce' stage shows a single box containing 'ad1: 12', 'ad7: 9', 'ad13: 8', representing the aggregation of the top click counts. Finally, an arrow points from the 'Reduce' stage to an 'Output' stage, which displays the text: 'Top 3 most clicked ads from the last minute are ad1, ad7 and ad13'. The task is explicitly stated as 'Task: get top 3' to the left of the Aggregate stage."
    width={500}
  />
</Frame>

The DAG model represents the well-known MapReduce paradigm. It is designed to take big data and use parallel distributed computing to turn big data into little\- or regular-sized data.

In the DAG model, intermediate data can be stored in memory and different nodes communicate with each other through either TCP (nodes running in different processes) or shared memory (nodes running in different threads).

#### Main Use Cases

Now that we understand how MapReduce works at the high level, let's take a look at how it can be utilized to support the main use cases:

- Aggregate the number of clicks of ad_id in the last *M* mins.
- Return top *N* most clicked ad_ids in the last *M* minutes.
- Data filtering.

##### Use Case 1: Aggregate the Number of Clicks

As shown in Figure 8, input events are partitioned by ad_id (ad_id % 3) in Map nodes and are then aggregated by Aggregation nodes.

<Frame caption="Figure 8 Aggregate the number of clicks">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-8-aggregate-the-number-of-clicks-GC2SNO2T.svg"
    alt="Image represents a data processing pipeline for clickstream analysis. A rectangular box labeled 'All Events' on the left represents the input stream of all ad clicks. This stream is fed into a 'Map' stage, depicted as a larger rectangle, which separates events based on `ad_id`. A legend shows diamonds representing `ad_id = 3`, circles for `ad_id = 1`, and squares for `ad_id = 2`. The Map stage sorts these events into three separate streams, each containing only one `ad_id`. These streams then flow into an 'Aggregate' stage, another larger rectangle, where events are grouped by `ad_id` and counted. The output, labeled 'Outputs', shows the aggregated results: 'ad3 was clicked 4 times in the past 1 minute', 'ad1 was clicked 3 times in the past 1 minute', and 'ad2 was clicked 5 times in the past 1 minute', indicating a one-minute aggregation interval. The entire process is depicted as a flow from left to right, with dashed lines separating the 'Inputs', 'Map', 'Aggregate', and 'Outputs' stages."
    width={600}
  />
</Frame>

##### Use Case 2: Return Top *N* Most Clicked Ads

Figure 9 shows a simplified design of getting the top 3 most clicked ads, which can be extended to top *N*. Input events are mapped using ad_id and each Aggregate node maintains a heap data structure to get the top 3 ads within the node efficiently. In the last step, the Reduce node reduces 9 ads (top 3 from each aggregate node) to the top 3 most clicked ads every minute.

<Frame caption="Figure 9 Return top N most clicked ads">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-9-return-top-n-most-clicked-ads-OAIQEEIN.svg"
    alt="Image represents a data processing pipeline for determining the top 3 most clicked ads within a one-minute interval. The pipeline begins with 'Inputs', specifically a box labeled 'Top 3 most clicked ads (Minute interval aggregation)' representing the desired output. 'All Events', a central box, feeds into three separate 'Map' stages. Each 'Map' stage receives a subset of events: one receives 'Events: ad3, ad6, ad9, ad12, ad15'; another receives 'Events: ad1, ad4, ad7, ad10, ad13'; and the last receives 'Events: ad2, ad5, ad8, ad11, ad14'. These subsets are then processed through individual 'Aggregate' stages, each counting the occurrences of each ad ID. The 'Aggregate' stages output lists like 'ad3: 12, ad6: 5, ad9: 3, ad12: 1, ad15: 1', showing ad IDs and their counts. These aggregated counts are then fed into a single 'Reduce' stage, which combines the counts from all ads across the three 'Aggregate' stages. The 'Reduce' stage outputs a consolidated list like 'ad3: 12, ad1: 9, ad2: 8, ad6: 5, ad4: 4, ad5: 4, ad9: 3, ad7: 3, ad8: 3', showing all ads and their total counts. Finally, the 'Outputs' section displays the result: 'Top 3 most clicked ads in the past 1 minute are ad3, ad1 and ad2', derived from the top three counts in the 'Reduce' stage's output. The entire process illustrates a MapReduce-like approach to real-time ad click aggregation."
    width={600}
  />
</Frame>

##### Use Case 3: Data Filtering

To support data filtering like "show me the aggregated click count for ad001 within the USA only", we can pre-define filtering criteria and aggregate based on them. For example, the aggregation results look like this for ad001 and ad002:

*Table 16 Aggregation results (filter by country)*

| **ad_id** | **click_minute** | **country** | **count** |
| --------- | ---------------- | ----------- | --------- |
| ad001     | 202101010001     | USA         | 100       |
| ad001     | 202101010001     | GPB         | 200       |
| ad001     | 202101010001     | others      | 3000      |
| ad002     | 202101010001     | USA         | 10        |
| ad002     | 202101010001     | GPB         | 25        |
| ad002     | 202101010001     | others      | 12        |

This technique is called the star schema <FootnoteRef id="11" />, which is widely used in data warehouses. The filtering fields are called dimensions. This approach has the following benefits:

- It is simple to understand and build.
- The current aggregation service can be reused to create more dimensions in the star schema. No additional component is needed.
- Accessing data based on filtering criteria is fast because the result is pre-calculated.

A limitation with this approach is that it creates many more buckets and records, especially when we have a lot of filtering criteria.

## Step 3 - Design Deep Dive

In this section, we will dive deep into the following:

- [Streaming Vs Batching](#streaming-vs-batching)
- [Time](#time)
- [Aggregation Window](#aggregation-window)
- [Delivery Guarantees](#delivery-guarantees)
- [Data Deduplication](#data-deduplication)
- [Scale the System](#scale-the-system)
- [Fault Tolerance](#fault-tolerance)
- [Data Monitoring and Correctness](#data-monitoring-and-correctness)
- Final design diagram

### Streaming Vs Batching

The high-level architecture we proposed in Figure 3 is a type of stream processing system. Table 17 shows the comparison of three types of systems <FootnoteRef id="12" />:

*Table 17 Comparison of three types of systems*

|                             | **Services (Online system)**     | **Batch system (offline system)**                      | **Streaming system (near real-time system)** |
| --------------------------- | -------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| **Responsiveness**          | Respond to the client quickly    | No response to the client needed                       | No response to the client needed             |
| **Input**                   | User requests                    | Bounded input with finite size. A large amount of data | Input has no boundary (infinite streams)     |
| **Output**                  | Responses to clients             | Materialized views, aggregated metrics, etc            | Materialized views, aggregated metrics, etc. |
| **Performance measurement** | Availability,<br /><br />latency | Throughput                                             | Throughput, latency                          |
| **Example**                 | Online shopping                  | MapReduce                                              | Flink <FootnoteRef id="13" />                |

In our design, both stream processing and batch processing are used. We utilized stream processing to process data as it arrives and generates aggregated results in a near real-time fashion. We utilized batch processing for historical data backup.

For a system that contains two processing paths (batch and streaming) simultaneously, this architecture is called lambda <FootnoteRef id="14" />. A disadvantage of lambda architecture is that you have two processing paths, meaning there are two codebases to maintain. Kappa architecture <FootnoteRef id="15" />, which combines the batch and streaming in one processing path, solves the problem. The key idea is to handle both real-time data processing and continuous data reprocessing using a single stream processing engine. Figure 10 shows a comparison of lambda and kappa architecture.

<Frame caption="Figure 10 Lambda and kappa architectures">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-10-lambda-and-kappa-architectures-QONSAGXY.svg"
    alt="Image represents two distinct data processing architectures, Lambda and Kappa, depicted side-by-side. The top section illustrates the Lambda Architecture, showing raw data ingested from a file, processed through a large cylinder representing an ingestion layer, and then split into two parallel processing paths. One path feeds into a 'Batch Engine' within a 'Batch Layer', while the other feeds into a 'Real-time Engine' within a 'Streaming Layer'. Both paths ultimately contribute to a 'Serving Backend' within a 'Serving Layer', which responds to 'Query' requests. The processed data from both paths is stored in a 'Results' database, alongside the original 'Raw Data'. The bottom section shows the Kappa Architecture, which is simpler, using only the streaming layer. Raw data is ingested, processed by a 'Real-time Engine' in the 'Streaming Layer', and then directly fed into the 'Serving Backend' within the 'Serving Layer' to respond to 'Query' requests. The processed data is stored in a 'Results' database, with the original 'Raw Data' also stored separately. Both architectures utilize a 'Data Storage' component to hold raw and processed data. The key difference is that Lambda uses both batch and real-time processing for improved latency and fault tolerance, while Kappa relies solely on real-time processing for speed and simplicity."
    width={700}
  />
</Frame>

Our high-level design uses Kappa architecture, where the reprocessing of historical data also goes through the real-time aggregation service. See the Data recalculation section below for details.

**Data recalculation**

Sometimes we have to recalculate the aggregated data, also called historical data replay. For example, if we discover a major bug in the aggregation service, we would need to recalculate the aggregated data from raw data starting at the point where the bug was introduced. Figure 11 shows the data recalculation flow:

1. The recalculation service retrieves data from raw data storage. This is a batched job.
2. Retrieved data is sent to a dedicated aggregation service so that the real-time processing is not impacted by historical data replay.
3. Aggregated results are sent to the second message queue, then updated in the aggregation database.

<Frame caption="Figure 11 Recalculation service">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-11-recalculation-service-TBQYOE5V.svg"
    alt="Image represents a data processing pipeline for ad click aggregation. A `Log Watcher` feeds data into a `Message Queue`. This queue distributes data to two destinations: a `Data Aggregation Service`, which calculates ad counts and top 100 clicked ads (aggregated every minute) and sends the results to a `Message Queue`; and a `Database Writer`, which stores raw data in a `Raw data database`. The `Message Queue` also receives aggregation results from a `Data Aggregation Service` (labeled as 'Poll aggregation result'). A separate `Data Aggregation Service` (marked as 'Recalculation only') processes data from the `Raw data database` (labeled '1') via a `Recalculation Service` (labeled '2'). This recalculated data is then sent to a `Database Writer`, which populates an `Aggregation database`. Finally, a `Query Service` (Dashboard) retrieves data from the `Aggregation database` (labeled 'Query aggregation result') to display aggregated ad click information. The numbers '1', '2', and '3' indicate the flow of data between components."
    width={700}
  />
</Frame>

The recalculation process reuses the data aggregation service but uses a different data source (the raw data).

### Time

We need a timestamp to perform aggregation. The timestamp can be generated in two different places:

- **Event time**: when an ad click happens.
- **Processing time**: refers to the system time of the aggregation server that processes the click event.

Due to network delays and asynchronous environments (data go through a message queue), the gap between event time and processing time can be large. As shown in Figure 12, event 1 arrives at the aggregation service very late (5 hours later).

<Frame caption="Figure 12 Late events">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-12-late-events-XK3WSQ7H.svg"
    alt="Image represents a comparison of event time and processing time in a system. Two horizontal timelines are shown, one labeled 'Event Time' and the other 'Processing Time'. The Event Time line shows a sequence of events numbered 1, 2, and 3 occurring at 30, 60, and 90 seconds respectively. The Processing Time line shows the same events, but with a delay. Event 1 is processed at the same time as the event occurs, event 2 is processed starting at 60 seconds, and event 3 is processed starting at 90 seconds. Vertical dashed lines mark the 30, 60, and 90-second intervals on both timelines. A solid arrow indicates the progression of time on both timelines. A separate, light-pink-filled circle labeled '1' appears 5 hours after the end of the main timeline, connected by a dashed arrow, indicating that a processing event, likely a batch process, occurs much later after the initial events."
    width={500}
  />
</Frame>

If event time is used for aggregation, we have to deal with delayed events. If processing time is used for aggregation, the aggregation result may not be accurate. There is no perfect solution, so we need to consider the trade-offs.

*Table 18 Event time vs processing time*

|                 | **Pros**                                                                                     | **Cons**                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event time      | Aggregation results are more accurate because the client knows exactly when an ad is clicked | It depends on the timestamp generated on the client-side. Clients might have the wrong time, or the timestamp might be generated by malicious users |
| Processing time | Server timestamp is more reliable                                                            | The timestamp is not accurate if an event reaches the system at a much later time                                                                   |

Since data accuracy is very important, we recommend using event time for aggregation. How do we properly process delayed events in this case? A technique called "watermark" is commonly utilized to handle slightly delayed events.

In Figure 13, ad click events are aggregated in the one-minute tumbling window (see the Aggregation Window section for more details). If event time is used to decide whether the event is in the window, window 1 misses event 2, and window 3 misses event 5 because they arrive slightly later than the end of their aggregation windows.

<Frame caption="Figure 13 Miss events in an aggregation window">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-13-miss-events-in-an-aggregation-window-2BY3C3JD.svg"
    alt="Image represents a Gantt chart illustrating the processing of events over time using a windowed approach. The top line, labeled 'Event Time', shows a sequence of events occurring at 30-second intervals (0, 30, 60, 90, 120, 150, 180 seconds). Each event is numbered sequentially (1 through 5). The second line, 'Processing Time', depicts the actual processing time of these events, which is not necessarily instantaneous. The processing also follows a sequential order (1 through 5), but the duration of each processing step is variable. Below, three 'Windows' (1, 2, and 3) represent processing units or stages. Each window processes events sequentially, but with a delay. Window 1 processes event 1 from 0 to 60 seconds. Window 2 processes event 3 from 60 to 120 seconds. Window 3 processes event 4 from 120 to 180 seconds. The numbers within each window indicate the event being processed. Dashed vertical lines mark the 30-second intervals, aligning the event occurrences with their processing times across the different windows, showing the temporal relationship between event arrival, processing start, and completion within each window."
    width={600}
  />
</Frame>

One way to mitigate this problem is to use "watermark" (the extended rectangles in Figure 14), which is regarded as an extension of an aggregation window. This improves the accuracy of the aggregation result. By extending an extra 15-second (adjustable) aggregation window, window 1 is able to include event 2, and window 3 is able to include event 5.

The value set for the watermark depends on the business requirement. A long watermark could catch events that arrive very late, but it adds more latency to the system. A short watermark means data is less accurate, but it adds less latency to the system.

<Frame caption="Figure 14 Watermark technique">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-14-watermark-ATBVC4CB.svg"
    alt="Image represents a Gantt chart illustrating the processing of events within a system using a windowed approach. The top line, labeled 'Event Time', shows a timeline marked in 30-second intervals from 0 to 180 seconds, with numbered events (1 through 5) occurring at specific points. The second line, 'Processing Time', depicts the actual processing time of each event, showing a delay between event occurrence and processing start. Below, three 'Windows' (1, 2, and 3) represent processing units or stages. Each window processes events sequentially. Events are represented by numbered circles within each window, indicating the order of processing. Pink-shaded rectangles within each window highlight the processing time for a specific event within that window. The chart demonstrates that events are processed in windows, with later windows potentially processing events that have already occurred but are still within their processing window. The arrangement shows that events are processed sequentially within each window, but different windows may process events concurrently."
    width={600}
  />
</Frame>

Notice that the watermark technique does not handle events that have long delays. We can argue that it is not worth the return on investment (ROI) to have a complicated design for low probability events. We can always correct the tiny bit of inaccuracy with end-of-day reconciliation (see Reconciliation section). One trade-off to consider is that using watermark improves data accuracy but increases overall latency, due to extended wait time.

### Aggregation Window

According to the "Designing data-intensive applications" book by Martin Kleppmann <FootnoteRef id="16" />, there are four types of window functions: tumbling (also called fixed) window, hopping window, sliding window, and session window. We will discuss the tumbling window and sliding window as they are most relevant to our system.

In the tumbling window (highlighted in Figure 15), time is partitioned into same-length, non-overlapping chunks. The tumbling window is a good fit for aggregating ad click events every minute (use case 1).

<Frame caption="Figure 15 Tumbling window">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-15-tumbling-window-2JXIXGIH.svg"
    alt="Image represents a tumbling window aggregation process. A horizontal time axis labeled 'Minute' is divided into five one-minute intervals, numbered 1 through 5. Below the time axis is a rectangular box labeled 'Tumbling Window (1 minute window)' representing the aggregation window. This box is further divided into five equal segments, each aligned with a one-minute interval on the time axis. Each segment within the box contains the text 'Aggregate click count', indicating that within each one-minute window, the system aggregates the number of clicks. Dashed vertical lines separate the one-minute intervals, visually demonstrating the non-overlapping nature of the tumbling window. The diagram illustrates how data is processed in consecutive, non-overlapping one-minute windows, with click counts aggregated separately for each window."
    width={700}
  />
</Frame>

In the sliding window (highlighted in Figure 16), events are grouped within a window that slides across the data stream, according to a specified interval. A sliding window can be an overlapping one. This is a good strategy to satisfy our second use case; to get the top *N* most clicked ads during the last *M* minutes.

<Frame caption="Figure 16 Sliding window">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-16-sliding-window-OTVSYTQA.svg"
    alt="Image represents a sliding window mechanism for processing top ads. A horizontal time axis labeled 'Minute' is marked from 1 to 5, representing minutes. Two rectangular boxes, labeled 'Top ads from last 3 minutes', represent data windows. The top box starts at minute 1 and ends at minute 4, while the bottom box starts at minute 2 and ends at minute 5. These boxes overlap, illustrating a 3-minute sliding window. A description to the left explains that this is a 'Sliding window (3 minute window, Run every minute)', indicating that the process of identifying and presenting 'Top ads from last 3 minutes' runs every minute, creating a continuous stream of updated top ads based on the last three minutes of data. The dashed vertical lines at each minute mark delineate the time intervals."
    width={700}
  />
</Frame>

### Delivery Guarantees

Since the aggregation result is utilized for billing, data accuracy and completeness are very important. The system needs to be able to answer questions such as:

- How to avoid processing duplicate events?
- How to ensure all events are processed?

Message queues such as Kafka usually provide three delivery semantics: at-most once, at-least once, and exactly once.

**Which delivery method should we choose?**

In most circumstances, at-least once processing is good enough if a small percentage of duplicates are acceptable.

However, this is not the case for our system. Differences of a few percent in data points could result in discrepancies of millions of dollars. Therefore, we recommend exactly-once delivery for the system. If you are interested in learning more about a real-life ad aggregation system, take a look at how Yelp implements it <FootnoteRef id="17" />.

### Data Deduplication

One of the most common data quality issues is duplicated data. Duplicated data can come from a wide range of sources and in this section, we discuss two common sources.

- Client-side. For example, a client might resend the same event multiple times. Duplicated events sent with malicious intent are best handled by ad fraud/risk control components. If this is of interest, please refer to the reference material <FootnoteRef id="18" />.
- Server outage. If an aggregation service node goes down in the middle of aggregation and the upstream service hasn't yet received an acknowledgment, the same events might be sent and aggregated again. Let's take a closer look.

Figure 17 shows how the aggregation service node (Aggregator) outage introduces duplicate data. The Aggregator manages the status of data consumption by storing the offset in upstream Kafka.

<Frame caption="Figure 17 Duplicate data scenario">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-17-duplicate-data-3OV4V7EK.svg"
    alt="Image represents a sequence diagram illustrating a data aggregation system. Three main components are shown: 'Upstream…', 'Aggregator', and 'Downstream…'. The 'Upstream…' component initiates the process by sending a '1. Poll events' message to the 'Aggregator'. The 'Aggregator' then requests data with a '2. Consume from…' message to the 'Upstream…' component. Internally, the 'Aggregator' processes this data, indicated by '3. Aggregate events…', potentially involving internal looping. Once aggregated, the 'Aggregator' sends the results to 'Downstream…' via '4. Send aggregated…'. The 'Downstream…' component acknowledges receipt with '5. Ack back' to the 'Aggregator', which in turn acknowledges the upstream data consumption with '6. Ack upstream…' to the 'Upstream…' component. A cross symbol (x) next to '6. Ack upstream…' suggests potential data loss or error handling. The text 'Data duplication…' at the bottom indicates a potential issue or consideration related to data redundancy within the system. Dashed lines connect each component to represent asynchronous communication."
    width={600}
  />
</Frame>

If step 6 fails, perhaps due to Aggregator outage, events from 100 to 110 are already sent to the downstream, but the new offset 110 is not persisted in upstream Kafka. In this case, a new Aggregator would consume again from offset 100, even if those events are already processed, causing duplicate data.

The most straightforward solution (Figure 18) is to use external file storage, such as HDFS or S3, to record the offset. However, this solution has issues as well.

<Frame caption="Figure 18 Record the offset">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-18-record-the-offset-S65QC3DH.svg"
    alt="Image represents a sequence diagram illustrating the data flow and interaction between four components: 'Upstream…', 'Aggregator', 'HDFS / S3', and 'Downstream…'. The 'Upstream…' component initiates the process by sending a '1. Poll events' message to the 'Aggregator'. The 'Aggregator' responds with a '2. Consume from…' to acknowledge the request and receive data. Next, the 'Aggregator' interacts with 'HDFS / S3' to '3.1 Verify offset', ensuring data consistency. Then, it '3. Aggregate events…', potentially looping internally before '3.2 Save offset' to 'HDFS / S3', which is highlighted as potentially causing messages. Following aggregation, the 'Aggregator' sends '4. Send aggregated result' to 'Downstream…', receiving a '5. Ack back' confirmation. Finally, the 'Aggregator' sends '6. Ack upstream…' to complete the cycle. The dashed lines represent asynchronous communication, while solid lines with arrowheads indicate message flow direction. The red text highlights critical steps, particularly the potential for messages during offset saving."
    width={650}
  />
</Frame>

In step 3, the aggregator will process events from offset 100 to 110, only if the last offset stored in external storage is 100. If the offset stored in the storage is 110, the aggregator ignores events before offset 110.

But this design has a major problem: the offset is saved to HDFS / S3 (step 3.2) before the aggregation result is sent downstream. If step 4 fails due to Aggregator outage, events from 100 to 110 will never be processed by a newly brought up aggregator node, since the offset stored in external storage is 110.

To avoid data loss, we need to save the offset once we get an acknowledgment back from downstream. The updated design is shown in Figure 19.

<Frame caption="Figure 19 Save offset after receiving ack">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-19-save-offset-after-receiving-ack-ISTJJLCH.svg"
    alt="Image represents a sequence diagram illustrating the data flow between four components: 'Upstream…', 'Aggregator', 'HDFS / S3', and 'Downstream…'. The interaction begins with 'Upstream…' sending a '1. Poll events' message to the 'Aggregator'. The 'Aggregator' responds with a '2. Consume from…' to receive data. Next, the 'Aggregator' verifies an offset ('3.1 Verify offset') by interacting with 'HDFS / S3', a data storage system. After this verification, the 'Aggregator' processes the data ('3. Aggregate events…'), potentially involving internal operations represented by a loop. The aggregated result is then sent to 'Downstream…' ('4. Send aggregated result'), which acknowledges receipt ('5. Ack back'). Finally, the 'Aggregator' saves the updated offset in 'HDFS / S3' ('5.1 Save offset') and acknowledges the completion of the process to 'Upstream…' ('6. Ack upstream…'). The dashed lines represent asynchronous communication, while solid arrows indicate data flow and their direction."
    width={600}
  />
</Frame>

In this design, if the Aggregator is down before step 5.1 is executed, events from 100 to 110 will be sent downstream again. To achieve "exactly-once" processing, we need to put operations between step 4 to step 6 in one distributed transaction. A distributed transaction is a transaction that works across several nodes. If any of the operations fails, the whole transaction is rolled back.

<Frame caption="Figure 20 Distributed transaction">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-20-distributed-transaction-7V2ITRYZ.svg"
    alt="Image represents a sequence diagram illustrating the data flow in a system processing events. Four main components are shown: 'Upstream…', 'Aggregator', 'HDFS / S3', and 'Downstream…'. The process begins with 'Upstream…' sending a 'Poll events' request to the 'Aggregator'. The 'Aggregator' then requests data via 'Consume from…' from 'Upstream…'. Next, the 'Aggregator' verifies an offset (3.1 Verify offset) with 'HDFS / S3', a distributed storage system. After aggregating events (3. Aggregate events…), the 'Aggregator' sends the aggregated result to 'Downstream…' within a distributed transaction. The 'Aggregator' then saves the offset to 'HDFS / S3' (5. Save offset). 'Downstream…' sends an acknowledgment ('Ack back') to the 'Aggregator', which finally acknowledges 'Upstream…' ('Ack upstream…'). The dashed lines represent asynchronous communication, while solid lines indicate synchronous interactions. The diagram details the steps involved in event processing, highlighting the roles of each component and the data flow between them."
    width={650}
  />
</Frame>

As you can see, it's not easy to dedupe data in large-scale systems. How to achieve exactly-once processing is an advanced topic. If you are interested in the details, please refer to reference material <FootnoteRef id="19" />.

### Scale the System

From the back-of-the-envelope estimation, we know the business grows 30% per year, which doubles traffic every 3 years. How do we handle this growth? Let's take a look.

Our system consists of three independent components: message queue, aggregation service, and database. Since these components are decoupled, we can scale each one independently.

#### Scale The Message Queue

We have already discussed how to scale the message queue extensively in the Distributed Message Queue chapter, so we'll only briefly touch on a few points.

**Producers**. We don't limit the number of producer instances, so the scalability of producers can be easily achieved.

**Consumers**. Inside a consumer group, the rebalancing mechanism helps to scale the consumers by adding or removing nodes. As shown in Figure 21, by adding two more consumers, each consumer only processes events from one partition.

<Frame caption="Figure 21 Add consumers rebalancing">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-21-add-consumers-BXUUD54I.svg"
    alt="Image represents a before-and-after scenario of consumer group rebalancing in a message queue system. The left side shows an initial state where a single topic, labeled 'Topic', is partitioned into four parts (Partition 0, Partition 1, Partition 2, Partition 3). Two consumers, 'Consumer 0' and 'Consumer 1', are each consuming data from multiple partitions. Specifically, Consumer 0 consumes Partitions 0 and 1, while Consumer 1 consumes Partitions 2 and 3. A large arrow labeled 'Rebalance' separates the before and after states. The right side depicts the state after rebalancing. The same topic with its four partitions remains, but now each consumer ('Consumer 0', 'Consumer 1', 'Consumer 2', and 'Consumer 3') consumes exactly one partition. The consumers are highlighted in pink to emphasize the addition of two new consumers. The connections between partitions and consumers are represented by arrows indicating the flow of data from each partition to its assigned consumer."
    width={650}
  />
</Frame>

When there are hundreds of Kafka consumers in the system, consumer rebalance can be quite slow and could take a few minutes or even more. Therefore, if more consumers need to be added, try to do it during off-peak hours to minimize the impact.

**Brokers**

- **Hashing key**

    <Note>
      Using *ad_id* as hashing key for Kafka partition to store events from the same *ad_id* in the same Kafka partition. In this case, an aggregation service can subscribe to all events of the same *ad_id* from one single partition.
    </Note>

- **The number of partitions**

    <Note>
      If the number of partitions changes, events of the same *ad_id* might be mapped to a different partition. Therefore, it's recommended to pre-allocate enough partitions in advance, to avoid dynamically increasing the number of partitions in production.
    </Note>

- **Topic physical sharding**

    <Note>
      One single topic is usually not enough. We can split the data by geography (topic_north_america, topic_europe, topic_asia, etc.,) or by business type (topic_web_ads, topic_mobile_ads, etc).
    </Note>
    - Pros: Slicing data to different topics can help increase the system throughput. With fewer consumers for a single topic, the time to rebalance consumer groups is reduced.
    - Cons: It introduces extra complexity and increases maintenance costs.

#### Scale the Aggregation Service

In the high-level design, we talked about the aggregation service being a map/reduce operation. Figure 22 shows how things are wired together.

<Frame caption="Figure 22 Aggregation service MapReduce">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-22-aggregation-service-BW4ELD2M.svg"
    alt="Image represents a distributed MapReduce system architecture. Three Kafka instances serve as input sources, each feeding data to three Aggregation Servers (labeled 1, 2, and 3). Each Aggregation Server performs a 'Map process' on the received data, generating multiple intermediate results represented as small boxes. These intermediate results are then distributed across all three Aggregation Servers, which each perform a 'Reduce process' to aggregate the data received from the Map processes. The 'Reduce process' in each Aggregation Server receives input from all three Map processes. Finally, each Aggregation Server outputs a single result, representing the final output of the Reduce process for that server. The diagram shows data flowing from Kafka to the Map processes, then from the Map processes to the Reduce processes, and finally from the Reduce processes to the final output boxes. The labels clearly delineate the stages: 'Map Calculation', 'Map Output', 'Reduce Input', 'Reduce Calculation', and 'Reduce Output.'"
    width={600}
  />
</Frame>

If you are interested in the details, please refer to reference material <FootnoteRef id="20" />. Aggregation service is horizontally scalable by adding or removing nodes. Here is an interesting question; how do we increase the throughput of the aggregation service? There are two options.

Option 1: Allocate events with different ad_ids to different threads, as shown in Figure 23.

<Frame caption="Figure 23 Multi-threading aggregation">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-23-multi-threading-5R7SCVSP.svg"
    alt="Image represents a data processing pipeline. A central Kafka instance, labeled 'All Events', acts as a source, containing all events. These events are then distributed to two separate 'Aggregation Service Node' instances. The first node receives events for ad_ids 1 through 3, as indicated by the label 'Events of ad_id From 1 to 3'. This node then processes these events, distributing them across three threads, each handling a unique ad_id (thread_id = 1 handles ad_id = 1, thread_id = 2 handles ad_id = 2, and thread_id = 3 handles ad_id = 3). Similarly, the second Aggregation Service Node receives events for ad_ids 4 through 6 ('Events of ad_id From 4 to 6'), distributing them across three threads in the same manner (thread_id = 1 handles ad_id = 4, thread_id = 2 handles ad_id = 5, and thread_id = 3 handles ad_id = 6). The diagram illustrates a partitioning scheme where events are grouped by ad_id and processed concurrently by different threads within each aggregation service node. The dashed boxes visually separate the 'Aggregation Service Node' and 'Threads' components for each processing branch."
    width={600}
  />
</Frame>

Option 2: Deploy aggregation service nodes on resource providers like Apache Hadoop YARN <FootnoteRef id="21" />. You can think of this approach as utilizing multi-processing.

Option 1 is easier to implement and doesn't depend on resource providers. In reality, however, option 2 is more widely used because we can scale the system by adding more computing resources.

#### Scale the Database

Cassandra natively supports horizontal scaling, in a way similar to consistent hashing (Figure 24 <FootnoteRef id="22" />).

<Frame caption="Figure 24 Virtual nodes for Cassandra">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-24-virtual-nodes-MDUN2MVN.png"
    alt="Image represents a visual comparison of two data distribution methods across six nodes. The top half shows a ring structure labeled 'Ring without virtual nodes' with six nodes (A-F) arranged in a circle. Each node holds a single data element. Below this, the same six nodes are shown, but each node now contains two data elements, illustrating a simple data distribution. The bottom half depicts a similar scenario, but with a 'Ring with virtual nodes' structure. This ring contains more data elements (A-P) distributed across the same six nodes. Each node in the bottom section now holds four data elements, demonstrating a more complex data distribution using virtual nodes. The arrangement in both halves is consistent: three nodes are shown in the top row and three in the bottom row, labeled 'Node 1', 'Node 2', 'Node 3', 'Node 4', 'Node 5', and 'Node 6' respectively. The data elements (letters A-F or A-P) are distributed across the nodes in both scenarios, showing how the virtual nodes in the second example allow for a more even distribution of a larger dataset across the same number of physical nodes."
    width={550}
  />
</Frame>

Data is evenly distributed to every node with a proper replication factor. Each node saves its own part of the ring based on hashed value and also saves copies from other virtual nodes.

If we add a new node to the cluster, it automatically rebalances the virtual nodes among all nodes. No manual resharding is required. See Cassandra's official documentation for more details <FootnoteRef id="22" />.

#### Hotspot Issue

A shard or service that receives much more data than the others is called a hotspot. This occurs because major companies have advertising budgets in the millions of dollars and their ads are clicked more often. Since events are partitioned by *ad_id*, some aggregation service nodes might receive many more ad click events than others, potentially causing server overload.

This problem can be mitigated by allocating more aggregation nodes to process popular ads. Let's take a look at an example as shown in Figure 25. Assume each aggregation node can handle only 100 events.

1. Since there are 300 events in the aggregation node (beyond the capacity of a node can handle), it applies for extra resources through the resource manager.
2. The resource manager allocates more resources (for example, add two more aggregation nodes) so the original aggregation node isn't overloaded.
3. The original aggregation node split events into 3 groups and each aggregation node handles 100 events.
4. The result is written back to the original aggregate node.

<Frame caption="Figure 25 Allocate more aggregation nodes">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-25-allocate-more-aggregation-nodes-KLEMMHRW.svg"
    alt="Image represents a data processing pipeline employing a MapReduce-like architecture. Data Input feeds into a 'Map' component, which outputs 'ad1, 300 events' to an 'Aggregate' component. This 'Aggregate' then, needing more resources, requests them via step (1) from a 'Resource Manager', receiving them in step (2) as 'Extra resource allocated'. The 300 events are then split (3) and processed by three separate 'Aggregate' components, each handling 100 events. These three 'Aggregate' components feed into a 'Reduce' component, which outputs the 'Reduced result' (4) back to the initial 'Aggregate' component. Finally, the initial 'Aggregate' component feeds into another 'Reduce' component, producing the 'Aggregated Output'. The dashed box highlights the parallel processing of the three 'Aggregate' components before the final reduction. The entire system demonstrates a scalable approach to data processing, handling a large input dataset by distributing the workload across multiple 'Aggregate' components."
    width={600}
  />
</Frame>

There are more sophisticated ways to handle this problem, such as Global-Local Aggregation or Split Distinct Aggregation. For more information, please refer to <FootnoteRef id="23" />.

### Fault Tolerance

Let's discuss the fault tolerance of the aggregation service. Since aggregation happens in memory, when an aggregation node goes down, the aggregated result is lost as well. We can rebuild the count by replaying events from upstream Kafka brokers.

Replaying data from the beginning of Kafka is slow. A good practice is to save the "system status" like upstream offset to a snapshot and recover from the last saved status. In our design, the "system status" is more than just the upstream offset because we need to store data like top *N* most clicked ads in the past *M* minutes.

Figure 26 shows a simple example of what the data looks like in a snapshot.

<Frame caption="Figure 26 Data in a snapshot">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-26-data-in-a-snapshot-LYYIZPTJ.svg"
    alt="Image represents a data processing pipeline showing how click data for advertisements is aggregated and visualized. A cylindrical 'Message Queue' feeds data into a 'Data Aggregation Service'. This service receives click counts for ads (ad1, ad2, ad3) over a 5-minute period. The aggregated counts from the Data Aggregation Service (ad1: 12, ad3: 5, ad2: 3) are then passed to a visualization component, represented by a dashed-line box labeled 'Snapshot for top 3 most clicked ads from last 5 minutes'. Inside this box, each ad's total click count is shown alongside a breakdown of clicks per minute (minute 1 to 5). For example, ad1 shows a total of 12 clicks, distributed as 1, 3, 2, 3, and 3 clicks across the five minutes. A horizontal time axis below the visualization indicates the minutes (1-5). The arrows indicate the flow of data from the queue, through the aggregation service, and finally to the visualization."
    width={500}
  />
</Frame>

With a snapshot, the failover process of the aggregation service is quite simple. If one aggregation service node fails, we bring up a new node and recover data from the latest snapshot (Figure 27). If there are new events that arrive after the last snapshot was taken, the new aggregation node will pull those data from the Kafka broker for replay.

<Frame caption="Figure 27 Aggregation node failover">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-27-aggregation-node-failover-XJC6Z35G.svg"
    alt="Image represents a system architecture for data aggregation. At the top, a box labeled 'External Nodes' represents the source of incoming data. This box has two solid lines pointing downwards, connecting to two rectangular boxes at the bottom. The left box is labeled 'Primary aggregation node', and the right box is labeled 'New aggregation node'. A dashed line connects the 'External Nodes' box to the 'Primary aggregation node' box, indicating a less direct or potentially intermittent connection, marked with a red 'X' suggesting a point of failure or potential interruption. A cylindrical shape labeled 'Snapshot Storage' sits centrally between the two bottom boxes. A dashed arrow points from the 'Primary aggregation node' to the 'Snapshot Storage', labeled 'Incremental Snapshot', showing that incremental data updates are sent to the storage. Another dashed arrow connects the 'Snapshot Storage' to the 'New aggregation node', indicating that data is also retrieved from the storage by the new node. The solid line from 'External Nodes' to 'New aggregation node' suggests a direct data stream to the new node. The overall diagram illustrates a system where data from external sources is aggregated by a primary node, stored incrementally, and potentially also directly fed to a new aggregation node for redundancy or scalability."
    width={500}
  />
</Frame>

### Data Monitoring and Correctness

As mentioned earlier, aggregation results can be used for RTB and billing purposes. It's critical to monitor the system's health and to ensure correctness.

#### Continuous Monitoring

Here are some metrics we might want to monitor:

- Latency. Since latency can be introduced at each stage, it's invaluable to track timestamps as events flow through different parts of the system. The differences between those timestamps can be exposed as latency metrics.
- Message queue size. If there is a sudden increase in queue size, we may need to add more aggregation nodes. Notice that Kafka is a message queue implemented as a distributed commit log, so we need to monitor the records-lag metrics instead.
- System resources on aggregation nodes: CPU, disk, JVM, etc.

#### Reconciliation

Reconciliation means comparing different sets of data in order to ensure data integrity. Unlike reconciliation in the banking industry, where you can compare your records with the bank's records, the result of ad click aggregation has no third-party result to reconcile with.

What we can do is to sort the ad click events by event time in every partition at the end of the day, by using a batch job and reconciling with the real-time aggregation result. If we have higher accuracy requirements, we can use a smaller aggregation window; for example, one hour. Please note, no matter which aggregation window is used, the result from the batch job might not match exactly with the real-time aggregation result, since some events might arrive late (see Time section).

Figure 28 shows the final design diagram with reconciliation support.

<Frame caption="Figure 28 Final design with reconciliation">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-28-final-design-Z676QMSA.svg"
    alt="Image represents a system architecture diagram for data aggregation and reporting. A `Log Watcher` feeds data into a `Message Queue`. This queue is consumed by a `Data Aggregation Service`, which aggregates ad counts and top 100 clicked ads every minute, writing the results to a `Database Writer`. This writer populates a `Raw data database`. Separately, the `Message Queue` also feeds a second `Data Aggregation Service` responsible for recalculations only. This service interacts with a `Recalculation Service`, which in turn, along with the `Raw data database`, feeds into a `Reconciliation` component. Finally, an `Aggregation database` stores the aggregated data, which is queried by a `Query Service (Dashboard)` for reporting purposes. The `Aggregation database` receives data from both the initial `Database Writer` and the `Recalculation Service`, ensuring data consistency and accuracy."
    width={600}
  />
</Frame>

### Alternative Design

In a generalist system design interview, you are not expected to know the internals of different pieces of specialized software used in a big data pipeline. Explaining your thought process and discussing trade-offs is very important, which is why we propose a generic solution. Another option is to store ad click data in Hive, with an ElasticSearch layer built for faster queries. Aggregation is usually done in OLAP databases such as ClickHouse <FootnoteRef id="24" /> or Druid <FootnoteRef id="25" />. Figure 29 shows the architecture.

<Frame caption="Figure 29 Alternative design">
  <img
    src="./assets/22-ad-click-event-aggregation/figure-29-alternative-design-PS4NXR5P.svg"
    alt="Image represents a data processing pipeline. It begins with a `Log Watcher` that feeds data into a `Message Queue`. This queue acts as a buffer, sending data to a `Risk Control Engine`. The engine processes the data and then sends it to two separate data storage systems: `Hive` and `ClickHouse`. `Hive` data is then further processed and sent to `ElasticSearch`. `ClickHouse` receives data from the `Risk Control Engine` and its aggregated query results are fed into `Merchant Facing Analytics`. Separately, `ElasticSearch` receives queries from `Data Scientist Queries`, forming a two-way interaction where data scientists can query the data stored in `ElasticSearch`. The overall flow is unidirectional, except for the feedback loop between `ElasticSearch` and `Data Scientist Queries`."
    width={600}
  />
</Frame>

For more detail on this, please refer to reference material <FootnoteRef id="26" />.

## Step 4 - Wrap Up

In this chapter, we went through the process of designing an ad click event aggregation system at the scale of Facebook or Google. We covered:

- Data model and API design.
- Use MapReduce paradigm to aggregate ad click events.
- Scale the message queue, aggregation service, and database.
- Mitigate hotspot issue.
- Monitor the system continuously.
- Use reconciliation to ensure correctness.
- Fault tolerance.

The ad click event aggregation system is a typical big data processing system. It will be easier to understand and design if you have prior knowledge or experience with industry-standard solutions such as Apache Kafka, Apache Flink, or Apache Spark.

Congratulations on getting this far! Now give yourself a pat on the back. Good job!

## Chapter Summary

<Frame>
  <img
    src="./assets/22-ad-click-event-aggregation/chapter-summary-3GZY2XSW.webp"
    alt="Image represents a mind map outlining the steps involved in designing an Ads Aggregation system. The central node is 'Ads Aggregation', branching into four main steps: Step 1 focuses on defining requirements, splitting into 'functional req' (covering aggregate count, return top 100, aggregation filtering, and correctness) and 'non-functional req' (addressing handle delayed events, robustness, and minutes latency). Step 2 delves into design, encompassing estimation (considering 1 billion ads click, 50K peak QPS, and 100GB daily storage), query API design, data model (handling raw and aggregated data, requiring comparison and database selection), and high-level design (exploring async processing using MapReduce and supporting 3 use cases). Step 3 addresses operational aspects, including streaming vs. batching, time considerations, aggregation window, delivery guarantees, system scalability, fault tolerance, and data monitoring and correctness. Finally, Step 4 concludes with a wrap-up, suggesting an alternative solution if needed. The entire diagram uses a tree-like structure, with each step branching into more specific considerations and design choices."
    width={550}
  />
</Frame>

## Reference Materials

<Footnotes>
  <Footnote id="1">
    Clickthrough rate (CTR): Definition: [https://support.google.com/google-ads/answer/2615875?hl=en](https://support.google.com/google-ads/answer/2615875?hl=en)
  </Footnote>
  <Footnote id="2">
    Conversion rate: Definition: [https://support.google.com/google-ads/answer/2684489?hl=en](https://support.google.com/google-ads/answer/2684489?hl=en)
  </Footnote>
  <Footnote id="3">
    OLAP functions: [https://docs.oracle.com/database/121/OLAXS/olap_functions.htm#OLAXS169](https://docs.oracle.com/database/121/OLAXS/olap_functions.htm#OLAXS169)
  </Footnote>
  <Footnote id="4">
    Display Advertising with Real-Time Bidding (RTB) and Behavioural Targeting: [https://arxiv.org/pdf/1610.03013.pdf](https://arxiv.org/pdf/1610.03013.pdf)
  </Footnote>
  <Footnote id="5">
    LanguageManual ORC: [https://cwiki.apache.org/confluence/display/hive/languagemanual+orc](https://cwiki.apache.org/confluence/display/hive/languagemanual+orc)
  </Footnote>
  <Footnote id="6">
    Parquet: [https://databricks.com/glossary/what-is-parquet](https://databricks.com/glossary/what-is-parquet)
  </Footnote>
  <Footnote id="7">
    What is avro: [https://www.ibm.com/topics/avro](https://www.ibm.com/topics/avro)
  </Footnote>
  <Footnote id="8">
    Big Data: [https://www.datakwery.com/techniques/big-data/](https://www.datakwery.com/techniques/big-data/)
  </Footnote>
  <Footnote id="9">
    DAG model [https://en.wikipedia.org/wiki/Directed_acyclic_graph](https://en.wikipedia.org/wiki/Directed_acyclic_graph)
  </Footnote>
  <Footnote id="10">
    Java stream: [https://docs.oracle.com/javase/8/docs/api/java/util/stream/Stream.html](https://docs.oracle.com/javase/8/docs/api/java/util/stream/Stream.html)
  </Footnote>
  <Footnote id="11">
    Understand star schema and the importance for Power BI: [https://docs.microsoft.com/en-us/power-bi/guidance/star-schema](https://docs.microsoft.com/en-us/power-bi/guidance/star-schema)
  </Footnote>
  <Footnote id="12">Martin Kleppmann, "Designing Data-Intensive Applications", 2017</Footnote>
  <Footnote id="13">Apache Flink: [https://flink.apache.org/](https://flink.apache.org/)</Footnote>
  <Footnote id="14">Lambda architecture: [https://databricks.com/glossary/lambda-architecture](https://databricks.com/glossary/lambda-architecture)</Footnote>
  <Footnote id="15">Kappa architecture: [https://hazelcast.com/glossary/kappa-architecture/](https://hazelcast.com/glossary/kappa-architecture/)</Footnote>
  <Footnote id="16">Martin Kleppmann, "Stream Processing, Designing Data-Intensive Applications", 2017</Footnote>
  <Footnote id="17">
    End-to-end Exactly-once Aggregation Over Ad Streams: [https://www.youtube.com/watch?v=hzxytnPcAUM](https://www.youtube.com/watch?v=hzxytnPcAUM)
  </Footnote>
  <Footnote id="18">
    Ad traffic quality: [https://www.google.com/ads/adtrafficquality](https://www.google.com/ads/adtrafficquality/)
  </Footnote>
  <Footnote id="19">
    An Overview of End-to-End Exactly-Once Processing in Apache Flink: [https://flink.apache.org/features/2018/03/01/end-to-end-exactly-once-apache-flink.html](https://flink.apache.org/features/2018/03/01/end-to-end-exactly-once-apache-flink.html)
  </Footnote>
  <Footnote id="20">
    Understanding MapReduce in Hadoop: [https://www.section.io/engineering-education/understanding-map-reduce-in-hadoop/](https://www.section.io/engineering-education/understanding-map-reduce-in-hadoop/)
  </Footnote>
  <Footnote id="21">
    Flink on Apache Yarn: [https://ci.apache.org/projects/flink/flink-docs-release-1.13/docs/deployment/resource-providers/yarn/](https://ci.apache.org/projects/flink/flink-docs-release-1.13/docs/deployment/resource-providers/yarn/)
  </Footnote>
  <Footnote id="22">
    How data is distributed across a cluster (using virtual nodes): [https://docs.datastax.com/en/cassandra-oss/3.0/cassandra/architecture/archDataDistributeDistribute.html](https://docs.datastax.com/en/cassandra-oss/3.0/cassandra/architecture/archDataDistributeDistribute.html)
  </Footnote>
  <Footnote id="23">
    Flink performance tuning: [https://nightlies.apache.org/flink/flink-docs-master/docs/dev/table/tuning/](https://nightlies.apache.org/flink/flink-docs-master/docs/dev/table/tuning/)
  </Footnote>
  <Footnote id="24">ClickHouse: [https://clickhouse.com/](https://clickhouse.com/)</Footnote>
  <Footnote id="25">Druid: [https://druid.apache.org/](https://druid.apache.org/)</Footnote>
  <Footnote id="26">
    Real-Time Exactly-Once Ad Event Processing with Apache Flink, Kafka, and Pinot: [https://eng.uber.com/real-time-exactly-once-ad-event-processing/](https://eng.uber.com/real-time-exactly-once-ad-event-processing)
  </Footnote>
</Footnotes>
