---
layout: layout.njk
---
<style>
	body {
	   font-family: Helvetica, arial, sans-serif;
	   font-size: 14px;
	   line-height: 1.6;
	   padding-bottom: 10px;
	   background-color: white;
	}

	body > *:first-child {
	   margin-top: 0 !important; }
	body > *:last-child {
	   margin-bottom: 0 !important; }

	a {
	   color: #4183C4; }
	a.absent {
	   color: #cc0000; }
	a.anchor {
	   display: block;
	   padding-left: 30px;
	   margin-left: -30px;
	   cursor: pointer;
	   position: absolute;
	   top: 0;
	   left: 0;
	   bottom: 0; }

	h1, h2, h3, h4, h5, h6 {
	   margin: 20px 0 10px;
	   padding: 0;
	   font-weight: bold;
	   -webkit-font-smoothing: antialiased;
	   cursor: text;
	   position: relative; }

	h1:hover a.anchor, h2:hover a.anchor, h3:hover a.anchor, h4:hover a.anchor, h5:hover a.anchor, h6:hover a.anchor {
	   text-decoration: none; }

	h1 tt, h1 code {
	   font-size: inherit; }

	h2 tt, h2 code {
	   font-size: inherit; }

	h3 tt, h3 code {
	   font-size: inherit; }

	h4 tt, h4 code {
	   font-size: inherit; }

	h5 tt, h5 code {
	   font-size: inherit; }

	h6 tt, h6 code {
	   font-size: inherit; }

	h1 {
	   font-size: 28px;
	   color: black; }

	h2 {
	   font-size: 24px;
	   border-bottom: 1px solid #cccccc;
	   color: black; }

	h3 {
	   font-size: 18px; }

	h4 {
	   font-size: 16px; }

	h5 {
	   font-size: 14px; }

	h6 {
	   color: #777777;
	   font-size: 14px; }

	p, blockquote, ul, ol, dl, li, table, pre {
	   margin: 15px 0; }

	hr {
	   color: #333333;
	   height: 4px;
	   padding: 0;
	}

	section {
		width: 854px;
		margin: 0 auto;
	}

	body > h2:first-child {
	   margin-top: 0;
	   padding-top: 0; }
	body > h1:first-child {
	   margin-top: 0;
	   padding-top: 0; }
	body > h1:first-child + h2 {
	   margin-top: 0;
	   padding-top: 0; }
	body > h3:first-child, body > h4:first-child, body > h5:first-child, body > h6:first-child {
	   margin-top: 0;
	   padding-top: 0; }

	a:first-child h1, a:first-child h2, a:first-child h3, a:first-child h4, a:first-child h5, a:first-child h6 {
	   margin-top: 0;
	   padding-top: 0; }

	h1 p, h2 p, h3 p, h4 p, h5 p, h6 p {
	   margin-top: 0; }

	li p.first {
	   display: inline-block; }
	li {
	   margin: 0; }
	ul, ol {
	   padding-left: 30px; }

	ul :first-child, ol :first-child {
	   margin-top: 0; }

	dl {
	   padding: 0; }
	dl dt {
	   font-size: 14px;
	   font-weight: bold;
	   font-style: italic;
	   padding: 0;
	   margin: 15px 0 5px; }
	dl dt:first-child {
	   padding: 0; }
	dl dt > :first-child {
	   margin-top: 0; }
	dl dt > :last-child {
	   margin-bottom: 0; }
	dl dd {
	   margin: 0 0 15px;
	   padding: 0 15px; }
	dl dd > :first-child {
	   margin-top: 0; }
	dl dd > :last-child {
	   margin-bottom: 0; }

	blockquote {
	   border-left: 4px solid #dddddd;
	   padding: 0 15px;
	   color: #777777; }
	blockquote > :first-child {
	   margin-top: 0; }
	blockquote > :last-child {
	   margin-bottom: 0; }

	table {
	   padding: 0;border-collapse: collapse; }
	table tr {
	   border-top: 1px solid #cccccc;
	   background-color: white;
	   margin: 0;
	   padding: 0; }
	table tr:nth-child(2n) {
	   background-color: #f8f8f8; }
	table tr th {
	   font-weight: bold;
	   border: 1px solid #cccccc;
	   margin: 0;
	   padding: 6px 13px; }
	table tr td {
	   border: 1px solid #cccccc;
	   margin: 0;
	   padding: 6px 13px; }
	table tr th :first-child, table tr td :first-child {
	   margin-top: 0; }
	table tr th :last-child, table tr td :last-child {
	   margin-bottom: 0; }

	img {
	   max-width: 100%; }

	span.frame {
	   display: block;
	   overflow: hidden; }
	span.frame > span {
	   border: 1px solid #dddddd;
	   display: block;
	   float: left;
	   overflow: hidden;
	   margin: 13px 0 0;
	   padding: 7px;
	   width: auto; }
	span.frame span img {
	   display: block;
	   float: left; }
	span.frame span span {
	   clear: both;
	   color: #333333;
	   display: block;
	   padding: 5px 0 0; }
	span.align-center {
	   display: block;
	   overflow: hidden;
	   clear: both; }
	span.align-center > span {
	   display: block;
	   overflow: hidden;
	   margin: 13px auto 0;
	   text-align: center; }
	span.align-center span img {
	   margin: 0 auto;
	   text-align: center; }
	span.align-right {
	   display: block;
	   overflow: hidden;
	   clear: both; }
	span.align-right > span {
	   display: block;
	   overflow: hidden;
	   margin: 13px 0 0;
	   text-align: right; }
	span.align-right span img {
	   margin: 0;
	   text-align: right; }
	span.float-left {
	   display: block;
	   margin-right: 13px;
	   overflow: hidden;
	   float: left; }
	span.float-left span {
	   margin: 13px 0 0; }
	span.float-right {
	   display: block;
	   margin-left: 13px;
	   overflow: hidden;
	   float: right; }
	span.float-right > span {
	   display: block;
	   overflow: hidden;
	   margin: 13px auto 0;
	   text-align: right; }

	code, tt {
	   margin: 0 2px;
	   padding: 0 5px;
	   white-space: nowrap;
	   border: 1px solid #eaeaea;
	   background-color: #f8f8f8;
	   border-radius: 3px; }

	pre code {
	   margin: 0;
	   padding: 0;
	   white-space: pre;
	   border: none;
	   background: transparent; }

	.highlight pre {
	   background-color: #f8f8f8;
	   border: 1px solid #cccccc;
	   font-size: 13px;
	   line-height: 19px;
	   overflow: auto;
	   padding: 6px 10px;
	   border-radius: 3px; }

	pre {
	   background-color: #f8f8f8;
	   border: 1px solid #cccccc;
	   font-size: 13px;
	   line-height: 19px;
	   overflow: auto;
	   padding: 6px 10px;
	   border-radius: 3px; }
	pre code, pre tt {
	   background-color: transparent;
	   border: none; }

	sup {
	   font-size: 0.83em;
	   vertical-align: super;
	   line-height: 0;
	}
	* {
		 -webkit-print-color-adjust: exact;
	}
	@media screen and (min-width: 914px) {
	   body {
	      margin:0 auto;
	   }
	}
	@media print {
		 table, pre {
			  page-break-inside: avoid;
		 }
		 pre {
			  word-wrap: break-word;
		 }
	}
</style>

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

# How to Use An Leabharlann Ghealach

Welcome to **An Leabharlann Ghealach**, a database for Irish and Celtic source texts. This website will allow users to log and cite texts, keep track of secondary analyses, and discover new texts in the network. An Leabharlann will help keep track of all editions and translations of a text and where they can be found online.

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
> Used for all people who write, edit, or translate a [Text](#Text).

<a id="text"></a>
### Text
> A Text is the pure form of a document or writing, the Platonic ideal of a text, not associated with any edition or translation.
>
> For example, the Iliad is a Text, written by Homer. Robert Fagles' 1990 book titled "The Iliad" by Homer, published by Penguin Classics, in which he translates the epic into English, is also the Iliad by Homer, but not the pure Text itself. Rather, it is an Edition and Translation of the Text.
>
> The Text is an umbrella category under which are organized all other nodes related to that Text.

<a id="edition"></a>
### Edition
> A printed or published instantiation of a [Text](#Text), which appears on its own as a standalone book or article, or is published in a journal, or is contained in an anthology.
>
>A book like *The Lord of the Rings: Return of the King* is a Text, and all the many printings and reprintings of that book are its **Editions**; but at the same time, a Text like the *Bretha Déin Chécht* was published in *Ériu* Vol. XX, along with a new translation, and both the original text and translation count as **Editions** of the original Text. 

<a id="publisher"></a>
### Publisher

### Translation

## Relationships

## WROTE
> Points from an Author to a Text or Edition that he wrote. This should also be used for the editor of a work, even if that person didn't specifically author the text itself.

</section>