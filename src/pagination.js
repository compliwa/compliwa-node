/**
 * compliwa-node — src/pagination.js
 *
 * A list that has pages (x-sdk paginated: a `cursor` query parameter, an answer with `has_more` and
 * `next_cursor`) answers a PagePromise. Use it either way:
 *
 *   const page = await compliwa.verifications.list({ limit: 50 });   // one page, as the API sent it
 *   page.data; page.has_more; page.next_cursor;
 *
 *   for await (const verification of compliwa.verifications.list({ status: 'completed' })) {
 *     …                                                               // every item, page after page
 *   }
 *
 *   const all = await compliwa.verifications.list().toArray({ max: 500 });
 *
 * Pages are fetched one at a time, only as you read them. The filters you passed apply to every page.
 */

export class PagePromise {
  /** @param {(query: Record<string, unknown>) => Promise<any>} fetchPage */
  constructor(fetchPage, query = {}) {
    this.fetchPage = fetchPage;
    this.query = { ...query };
    this.first = null;
  }

  /** The first page (fetched once, however often you await it). */
  firstPage() {
    this.first ??= this.fetchPage(this.query);
    return this.first;
  }

  then(onFulfilled, onRejected) {
    return this.firstPage().then(onFulfilled, onRejected);
  }

  catch(onRejected) {
    return this.firstPage().catch(onRejected);
  }

  finally(onFinally) {
    return this.firstPage().finally(onFinally);
  }

  /** Every page, starting with the first. */
  async *pages() {
    let page = await this.firstPage();
    yield page;
    while (page.has_more && page.next_cursor) {
      page = await this.fetchPage({ ...this.query, cursor: page.next_cursor });
      yield page;
    }
  }

  async *[Symbol.asyncIterator]() {
    for await (const page of this.pages()) yield* page.data;
  }

  /**
   * Every item in one array. `max` (default 10 000) stops a runaway read — past it you get a
   * RangeError, not a silently short array.
   */
  async toArray({ max = 10_000 } = {}) {
    const items = [];
    for await (const item of this) {
      if (items.length >= max) {
        throw new RangeError(`compliwa: more than ${max} items — narrow the filters, or pass a larger max`);
      }
      items.push(item);
    }
    return items;
  }
}

PagePromise.prototype[Symbol.toStringTag] = 'PagePromise';
