---
layout: layout.njk
CSS: "markdown.css"
---

<section>
<!-- Mermaid.js for rendering graph diagrams. -->
<script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
<script>mermaid.initialize({ startOnLoad:true });</script>
<style>
  .mermaid {
    display: flex;
    justify-content: center;
  }
</style>

# How to Use An Leabharlann Ghaelach

Welcome to **An Leabharlann Ghaelach**, a database for Irish and Celtic source texts. This website will allow users to log and cite texts, keep track of secondary analyses, and discover new texts in the network. An Leabharlann will help keep track of all editions and translations of a text and where they can be found online.

## Directory

- <a href="#1">1. A Graph Database</a>
- <a href="#2">2. How is the Database Structured?</a>
- <a href="#labels">Labels</a>

<a id="1"></a>
### 1. A Graph Database
<a href="https://neo4j.com" target="_blank">Neo4j</a> is a graph database language designed to store data as **nodes**, and connections between data as **relationships**. Unlike traditional databases that use tables, Neo4j organizes data into a graph structure, making it ideal for representing complex relationships, such as those between authors, texts, editions, publishers, websites, and text versions in this application.
- **Nodes**: Represent entities like Authors, Texts, or Publishers. Any data which might have multiple data points under it should be a node with properties. Each node has labels (e.g., 'Author', 'Text') and properties (e.g., 'name: "Jane Doe"').
- **Relationships**: Connect nodes through relationships like A 'WROTE' B or C 'PUBLISHED' D, allowing us to model how entities are related.

A node has properties, and a relationship connects nodes. For example, if we had a node for Homer, it would look like this:
<div class="mermaid">
graph LR
  H(("Author<br>name: Homer<br>born: 8th c. BC")):::entity
  classDef entity fill:#f9f9f9,stroke:#333,stroke-width:1px;
</div>

And if we had a node for the Iliad, it could look like this:
<div class="mermaid">
graph LR
  I(("Text<br>title: The Iliad<br>language: Ancient Greek")):::entity
  classDef entity fill:#f9f9f9,stroke:#333,stroke-width:1px;
</div> 

Then we could relate them by saying that Homer WROTE The Iliad:
<div class="mermaid">
graph LR;
  H(("Author<br>name: Homer<br>born: 8th c. BC")):::entity
  I(("Text<br>title: The Iliad<br>language: Ancient Greek")):::entity
  H -->|WROTE| I
  classDef entity fill:#f9f9f9,stroke:#333,stroke-width:1px;
</div>

You can see that each node is given a **label**, here "Author" and "Text". The name of the author and title of the text are properties stored *within* a node. All nodes have labels telling you what they *are*, while the properties of a node tell you *about* the data stored within. So Homer IS AN Author, and the Iliad IS A Text. This feature will become useful later when we discuss searching through the database. Note that a node can have an arbitrary number of labels, e.g. James Clarence Mangan IS AN Author and IS A Translator.

<a id="2"></a>
### 2. How is the Database Structured?
Due to the complexity of relationships in the humanities, no rigid structure could ever capture the unruly relationships of a humanities database without itself becoming unruly. But Neo4j allows users to set relationships that could be unique, as well as relationships that are extremely common. To capture all of these, users can create many different labels to suit their needs.

A node consists of a **label** and a list of **properties** and their values. There is no limit on what a label or property could be, although the value of a property must be a string or simple array, not a JSON object.

For example, the *Audacht Morainn* is a medieval Irish document. It is a **Text**. But Fergus Kelly's 1970 translation of the *Audacht Morainn* is an **Edition** and a **Translation** of that Text, not a Text itself. The two are connected with an EDITION_OF relationship. And Fergus Kelly TRANSLATED the *Audacht Morainn*. So we can create nodes with those properties, and connect them:

<div class="mermaid">
graph LR
  E(("Edition<br>title: Audacht Morainn<br>publication_date: 1970")):::edition
  T(("Text<br>title: Audacht Morainn")):::text
  F(("Author Translator<br>name: Fergus Kelly")):::person
  E -->|EDITION_OF| T
  F -->|WROTE| E
  F -->|TRANSLATED| T
  classDef edition fill:#f9f9f9,stroke:#333,stroke-width:1px;
  classDef text    fill:#f9f9f9,stroke:#333,stroke-width:1px;
  classDef person  fill:#f9f9f9,stroke:#333,stroke-width:1px;
</div>

See [Labels](#labels) below for a full list of all labels used and how to use them.

### 3. Logging In

### 4. The Homepage

Columns, searching, and logging in.

### 5. Creating a Node

Creating a node, adding labels, node properties, and relationships.

### 6. Relationships

Nodes connect to each other through relationships.

<a id="labels"></a>
## Labels
A list of all currently used labels and when / how to use each:

<a id="author"></a>
### Author
> Used for all people who write, edit, or translate a [Text](#text).

<a id="text"></a>
### Text
> A Text is the pure form of a document or writing, the Platonic ideal of a text, not associated with any edition or translation.
>
> For example, the Iliad is a Text, written by Homer. Robert Fagles' 1990 book titled "The Iliad" by Homer, published by Penguin Classics, in which he translates the epic into English, is also the Iliad by Homer, but not the pure Text itself. Rather, it is an Edition and Translation of the Text.
>
> The Text is an umbrella category under which are organized all other nodes related to that Text.
>
> Works that count as commentary on another text are [Commentaries](#commentary) and also [Texts](#text) themselves, and can also be [Articles](#article).

<a id="edition"></a>
### Edition
> A printed or published instantiation of a [Text](#text), which appears on its own as a standalone book or article, or is published in a journal, or is contained in an anthology.
>
>A book like *The Lord of the Rings: Return of the King* is a Text, and all the many printings and reprintings of that book are its **Editions**; but at the same time, a Text like the *Bretha Déin Chécht* was published in *Ériu* Vol. XX, along with a new translation, and both the original text and translation count as **Editions** of the original Text. 

<a id="version"></a>
### Version
> A Version represents a major variant of a [Text](#text). A single Version implies the existence of other Versions from which it deviates. A Version should not also be a Text.
>
> For example, the [Táin Bó Cúailnge](https://uisneac.com/leabharlann/info/index.html?id=086bc4d3-d5a0-4db6-aeca-2bf91eda6bea) is a Text which is known to us from multiple manuscript editions which differ in content, so we represent each recension as a different Version, e.g. [Táin Bó Cúailnge (Recension II)](https://uisneac.com/leabharlann/info/index.html?id=4e9e7e5c-3cd1-452c-8903-e6b73f68fd59)

<a id="publisher"></a>
### Publisher
> An organization or person that publishes works on any medium. 

<a id="translation"></a>
### Translation
> A Translation is an Edition which has been translated from its native language to another language. A Translation must have a [Translator](#translator) and derive from a source [Text](#text) or [Version](#version), which represents the work in its native language (though these requirements aren't enforced in the database code).
>
> Certain ancient Texts can also be Translations. For example, the [Latin Vulgate Bible](https://en.wikipedia.org/wiki/Vulgate) is a translation of a number of previous Biblical texts in Old Italic, Greek, Hebrew, etc., translated by Saint Jerome; yet it is an important divergence from those source texts in its own right, and there are many [Versions](#Version) of the Vulgate, so it may be both a Text, not an Edition, and a Translation at once.

<a id="translator"></a>
### Translator
> A Translator is any person who translates a [Text](#text) from one language to another.

<a id="commentary"></a>
### Commentary
> A Commentary is a [Text](#text) which is concerned in whole or in part with commentary on or critique of another Text.
>
> For example, the *Cath Maige Tuired* of Irish mythology is a [Text](https://uisneac.com/leabharlann/info/index.html?id=6b8fab4d-3722-4b49-80fb-a0a9c014da31), and the [Article](#article) by [Tomás Ó Cathasaigh](https://uisneac.com/leabharlann/info/index.html?id=c6673cd9-c00e-4a53-a46d-800c10f2f5e9) called [*Three Notes on the Cath Maige Tuired*](https://uisneac.com/leabharlann/info/index.html?id=bb36e67e-0361-4355-bdf3-d7144af4d48f) is a Text and a Commentary on another Text.

<a id="journal"></a>
### Journal
> A Journal is an academic publication which periodically presents [Articles](#article) on a given subject, contained within [Issues](#issue). An Issue is linked to its Journal via the [ISSUE_OF](#issue-of) relationship.
>
> For example, [Revue Celtique](https://uisneac.com/leabharlann/info/index.html?id=949c5778-ece0-4e31-ac11-0d5962021771) is a Journal which publishes [Issues](#issue) such as [Revue Celtique Tome 9](https://uisneac.com/leabharlann/info/index.html?id=feb1dfcc-699b-487a-bace-a58dbabcdb61).

### Issue
> An Issue is a publication of a [Journal](#journal) which contains the [Articles](#article) presented by the journal. An Issue is linked to its Journal via the [ISSUE_OF](#issue-of) relationship.
>
> For example, [Revue Celtique](https://uisneac.com/leabharlann/info/index.html?id=949c5778-ece0-4e31-ac11-0d5962021771) is a Journal which publishes [Issues](#issue) such as [Revue Celtique Tome 9](https://uisneac.com/leabharlann/info/index.html?id=feb1dfcc-699b-487a-bace-a58dbabcdb61).

## Relationships

## WROTE
> Points from an [Author](#Author) to a [Text](#Text) or [Edition](#Edition) that he wrote. This should also be used for the editor of a work, even if that person didn't specifically author the text itself.

## PUBLISHED

<a id="published-in"></a>
## PUBLISHED_IN
> Used on a [Text](#text) or [Article](#article) to indicate the [Journal](#journal), [Book](#book), or other publication that the Text is published within. Should point from the Text to the Journal.

## TRANSLATED

## VERSION_OF

## ISSUE_OF

</section>