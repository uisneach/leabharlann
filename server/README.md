## Server Structure


## Database Structure

Nodes:
- Author
	- name*
	- date-of-birth
	- date-of-death
	- ext-lnk
  - wiki-link
	- img-link
- Text
  - title*         # This should be its native-language title
  - english-title  # This should be its English title
  - description
- Edition
  - title*
  - publication-date*
  - ext-link

\*required

Relationships:
- Author WROTE Text
- Text PUBLISHED_IN Publication OR Series OR Anthology OR Edition
- Text PUBLISHED_BY Publisher

For example, the author Anonymous WROTE the Text *Aided Con Culainn*, which was PUBLISHED_IN [Revue Celtique, Tome III, 1876-1878](https://archive.org/details/revueceltiqu03pari/page/174/mode/2up).

Endpoints:
- GET Author
  - Parameters: author-name
  - Returns: JSON of author info and all relationships relating to that author.
- GET Text
  - Parameters: text-title
  - Returns: JSON of text info and all relationships relating to that text.
- GET Edition

### API Return Data

The structure of the data returned by the API upon a GET call to a node:

{
  "id": "node_id",
  "labels": ["Label1", "Label2"],
  "properties": {"property1":"value1"},
  "outgoingRels": [
  {
    "id": "relationship_id",
    "type": "RELATIONSHIP_TYPE",
    "direction": "outgoing",
    "node":
    {
      "id": "target_node_id",
      "label": "Label3",
      "property1": "value1"
    }
  }],
  "incomingRels": [
  {
    "id": "relationship_id",
    "type": "RELATIONSHIP_TYPE",
    "direction": "incoming",
    "node":
    {
      "id": "source_node_id"
      "label": "Label4",
      "property2": "value2"
    }
  }]
}