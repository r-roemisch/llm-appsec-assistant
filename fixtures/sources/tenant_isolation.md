# Fixture: Heliotrope tenant isolation notes

This document is a synthetic fixture for Rampart's offline tests and demo. Heliotrope and
the heliotrope-tenant label are fictional; the practice described is standard.

## Filter before you rank

A retrieval system that serves several users or tenants must apply access control inside
the search itself, not after the model has seen the results. Heliotrope stores the owner of
each passage as metadata on its vector and in the keyword index, and every query carries a
filter on the owners the caller may read. Passages from another tenant are never ranked,
so they can never reach the prompt.

## Check again against the system of record

Indexes drift: a deleted document can survive in a vector store, and a bug in a filter can
leak results. Heliotrope therefore loads every retrieved passage again from the primary
database, applying the same ownership rule, before it builds the prompt. Anything the
database does not confirm is dropped. The notes call this the heliotrope-tenant re-check.

## Deletion and logging

Deleting a document must remove its passages from every index, including vector stores, and
deleting an account must remove the account's documents. Log which passages were used for
each answer so that a reviewer can verify that no answer drew on another tenant's data.
