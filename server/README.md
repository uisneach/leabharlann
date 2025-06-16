## Server Structure


## Database Structure

Nodes:
- Author
  - Properties
  	- name
  	- date-of-birth
  	- date-of-death
  	- ext-lnk
  	- img-link
- Text
  - Properties
    - title          # This should be its native-language title
    - english-title  # This should be its English title
    - description
- Edition
  - Properties
    - title
    - publication-date
    - ext-link

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