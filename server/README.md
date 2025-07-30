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
  - language
  - description
- Source
- Secondary-Literature
- Manuscript
  - title*
  - place-of-origin
  - date-of-origin
  - ext-link
- Edition
  - title*
  - publication-date*
  - ext-link
- Publication
  - title*
  - editions       # This should be a list of other nodes (IDs?)
  - published-by   # Points to a PUBLISHER
- Publisher
  - name*
  - website-link
  - wiki-link

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


Insert this code into any GraphViz editor to see the structure:

```
digraph G {
  graph [fontsize=8, fontname="Helvetica"];
  node  [fontsize=10, fontname="Helvetica"];
  edge  [fontsize=8, fontname="Helvetica"];
 
  Text -> Author [label="WRITTEN_BY"];
  Text -> Edition [label="PUBLISHED_IN"];
  Edition -> Publisher [label="PUBLISHED_BY"];
  Edition -> Series [label="EDITION_OF"];
  Edition -> Journal [label="EDITION_OF"];
  Series -> Publisher [label="PUBLISHED_BY"];
  Journal -> Publisher [label="PUBLISHED_BY"];
  Edition -> Translator [label="TRANSLATED_BY"];
}
```

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

## Roadmap / Todo

### Planned Features