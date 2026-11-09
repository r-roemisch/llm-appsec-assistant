# Access control for retrieval-augmented generation

Written for Rampart. Related reading: OWASP LLM08:2025 Vector and Embedding Weaknesses and
LLM02:2025 Sensitive Information Disclosure.

## The rule

A retrieval-augmented application must never place a passage in a prompt unless the person
asking may read that passage. Once text reaches the model, the model can repeat it, so
asking the model to withhold information is not access control.

## Enforce access inside the search

Store the owner, tenant or classification of every passage alongside its vector and in the
keyword index, and give every query a filter on what the caller may read. Filtering after
ranking is weaker: it can leak through result counts and timing, and it fails open if a step
is forgotten. Shared reference material and private uploads can live in the same index as
long as every query filters on ownership.

## Confirm against the system of record

Vector stores and caches drift from the database: deletions may not propagate, metadata may
be wrong, a filter may have a bug. Load each retrieved passage again from the primary
database with the same visibility rule before building the prompt, and drop anything the
database does not confirm. The index is an optimisation; the database is the authority.

## Uploads and deletion

User uploads are private by default. Deleting an upload must remove its passages from every
index, and deleting an account must remove the account's uploads. Validate uploads by type
and size, extract text only from supported formats, and never execute or render uploaded
content.

## Poisoned and hostile documents

Any document can contain instructions aimed at the model, whether planted in a public
source or uploaded by a user. Label each passage with its provenance, wrap passages in
delimiters the content cannot forge, tell the model that passages are data, and keep tool
authorisation outside the model so that a hostile passage cannot trigger actions. Grading
retrieved passages for relevance also helps keep unrelated, possibly hostile, text out of
the prompt.

## Citations

Make answers cite the exact passages they used. Citations let a reader check a claim, make
hallucinated sources visible, and give reviewers a trail of which documents influenced which
answers.

## Embeddings are sensitive too

Embeddings can leak information about the text they encode (embedding inversion), so protect
the vector store like the documents themselves and send text to an external embedding
provider only when its terms allow that data.
