// Advanced query helpers for list endpoints: pagination, text search,
// equality filters, range filters, date filters, sorting, and a paginate() runner.

// Parse ?page & ?limit into safe numbers plus the mongo skip offset.
export const parsePagination = (query: any = {}, { defaultLimit = 10, maxLimit = 100 }: { defaultLimit?: number; maxLimit?: number } = {}): { page: number; limit: number; skip: number } => {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;
  return { page, limit, skip: (page - 1) * limit };
};

// Parse cursor-based pagination (alternative to page/limit)
export const parseCursorPagination = (query: any = {}, { defaultLimit = 10, maxLimit = 100 }: { defaultLimit?: number; maxLimit?: number } = {}): { limit: number; cursor: any; direction: string } => {
  const limit = Math.min(parseInt(query.limit, 10) || 10, maxLimit);
  const cursor = query.cursor || null;
  const direction = query.direction === 'prev' ? 'prev' : 'next';
  return { limit, cursor, direction };
};

// Build a case-insensitive OR-regex filter across the given fields.
// The search term is escaped so user input can't inject regex operators.
export const buildSearch = (search: any, fields: string[] = []): Record<string, any> => {
  const term = String(search || "").trim();
  if (!term || !fields.length) return {};
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(safe, "i");
  return { $or: fields.map((f: string) => ({ [f]: rx })) };
};

// Advanced search with multiple terms (AND logic) and field boosting
export const buildAdvancedSearch = (search: any, fields: string[] = [], options: any = {}): Record<string, any> => {
  const { exactMatch = false, minScore = 0 } = options;
  const terms: string[] = String(search || "").trim().split(/\s+/).filter(Boolean);
  if (!terms.length || !fields.length) return {};

  if (exactMatch && terms.length === 1) {
    const safe = terms[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(`^${safe}$`, "i");
    return { $or: fields.map((f: string) => ({ [f]: rx })) };
  }

  // Multiple terms - all must match (AND logic)
  const orClauses = terms.map((term: string) => {
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(safe, "i");
    return { $or: fields.map((f: string) => ({ [f]: rx })) };
  });

  return { $and: orClauses };
};

// Build equality filters from an allow-list of query params.
// Empty values and the sentinel "all" are ignored (treated as "no filter").
export const buildFilters = (query: any = {}, allowed: string[] = []): Record<string, any> => {
  const filter: Record<string, any> = {};
  for (const key of allowed) {
    const val = query[key];
    if (val !== undefined && val !== "" && val !== "all") filter[key] = val;
  }
  return filter;
};

// Advanced equality filters with support for arrays (IN queries) and nested paths
export const buildAdvancedFilters = (query: any = {}, allowed: string[] = [], options: any = {}): Record<string, any> => {
  const { arrayFields = [], nestedFields = [] } = options;
  const filter: Record<string, any> = {};

  for (const key of allowed) {
    const val = query[key];
    if (val === undefined || val === "" || val === "all") continue;

    // Handle array fields (IN queries)
    if (arrayFields.includes(key)) {
      const values: string[] = Array.isArray(val) ? val : String(val).split(",").map((v: string) => v.trim()).filter(Boolean);
      if (values.length) filter[key] = { $in: values };
      continue;
    }

    // Handle nested fields (dot notation)
    if (nestedFields.some((nf: string) => key.startsWith(nf))) {
      filter[key] = val;
      continue;
    }

    filter[key] = val;
  }
  return filter;
};

// Build range filters (gt, gte, lt, lte) for numeric and date fields
export const buildRangeFilters = (query: any = {}, allowed: Record<string, any> = {}): Record<string, any> => {
  // allowed: { fieldName: { type: 'number' | 'date', min?: string, max?: string } }
  const filter: Record<string, any> = {};

  for (const [field, config] of Object.entries(allowed as Record<string, any>)) {
    const { type = 'number' }: { type?: string } = config as any;
    const conditions: Record<string, any> = {};

    // Min / gt / gte
    if (query[`${field}[min]`] !== undefined && query[`${field}[min]`] !== "") {
      const val: any = type === 'date' ? new Date(query[`${field}[min]`]) : Number(query[`${field}[min]`]);
      if (!isNaN(val as any)) conditions.$gte = val;
    }
    if (query[`${field}[gt]`] !== undefined && query[`${field}[gt]`] !== "") {
      const val: any = type === 'date' ? new Date(query[`${field}[gt]`]) : Number(query[`${field}[gt]`]);
      if (!isNaN(val as any)) conditions.$gt = val;
    }

    // Max / lt / lte
    if (query[`${field}[max]`] !== undefined && query[`${field}[max]`] !== "") {
      const val: any = type === 'date' ? new Date(query[`${field}[max]`]) : Number(query[`${field}[max]`]);
      if (!isNaN(val as any)) conditions.$lte = val;
    }
    if (query[`${field}[lt]`] !== undefined && query[`${field}[lt]`] !== "") {
      const val: any = type === 'date' ? new Date(query[`${field}[lt]`]) : Number(query[`${field}[lt]`]);
      if (!isNaN(val as any)) conditions.$lt = val;
    }

    // Exact match
    if (query[field] !== undefined && query[field] !== "" && query[field] !== "all") {
      const val: any = type === 'date' ? new Date(query[field]) : Number(query[field]);
      if (!isNaN(val as any)) (conditions as any).$eq = val;
    }

    if (Object.keys(conditions).length) filter[field] = conditions;
  }
  return filter;
};

// Build date range filters with presets (today, week, month, etc.)
export const buildDateRangeFilter = (query: any = {}, field: string = "date", presets: Record<string, any> = {}): Record<string, any> => {
  // presets: { today: true, thisWeek: true, thisMonth: true, etc. }
  const filter: Record<string, any> = {};
  const now = new Date();
  let start: Date | null = null;
  let end: Date | null = null;

  if (query[`${field}[from]`]) {
    start = new Date(query[`${field}[from]`]);
  }
  if (query[`${field}[to]`]) {
    end = new Date(query[`${field}[to]`]);
    end.setHours(23, 59, 59, 999);
  }

  // Preset handling
  if (query[`${field}_preset`]) {
    const preset = query[`${field}_preset`];
    switch (preset) {
      case 'today':
        start = new Date(now.setHours(0, 0, 0, 0));
        end = new Date(now.setHours(23, 59, 59, 999));
        break;
      case 'thisWeek':
        start = new Date(now.setDate(now.getDate() - now.getDay()));
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        break;
      case 'thisMonth':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        break;
      case 'lastWeek':
        const lastWeekStart = new Date(now);
        lastWeekStart.setDate(now.getDate() - now.getDay() - 7);
        lastWeekStart.setHours(0, 0, 0, 0);
        start = lastWeekStart;
        const lastWeekEnd = new Date(lastWeekStart);
        lastWeekEnd.setDate(lastWeekStart.getDate() + 6);
        lastWeekEnd.setHours(23, 59, 59, 999);
        end = lastWeekEnd;
        break;
      case 'lastMonth':
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        break;
      case 'nextWeek':
        start = new Date(now);
        start.setDate(now.getDate() + (7 - now.getDay()));
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        break;
      case 'nextMonth':
        start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
        break;
      case 'upcoming':
        start = new Date();
        end = null;
        break;
      case 'past':
        start = null;
        end = new Date();
        end.setHours(23, 59, 59, 999);
        break;
    }
  }

  if (start || end) {
    const conditions: Record<string, any> = {};
    if (start) conditions.$gte = start;
    if (end) conditions.$lte = end;
    filter[field] = conditions;
  }

  return filter;
};

// Parse ?sort=field or ?sort=-field into a mongo sort object, restricted to an
// allow-list so callers can't sort by arbitrary/unindexed fields.
export const parseSort = (sort: any, allowed: string[] = [], fallback: Record<string, any> = { createdAt: -1 }): Record<string, any> => {
  if (!sort) return fallback;
  const desc = String(sort).startsWith("-");
  const field = desc ? String(sort).slice(1) : String(sort);
  if (!allowed.includes(field)) return fallback;
  return { [field]: desc ? -1 : 1 };
};

// Multi-field sort (e.g., sort=-createdAt,title)
export const parseMultiSort = (sort: any, allowed: string[] = [], fallback: Record<string, any> = { createdAt: -1 }): Record<string, any> => {
  if (!sort) return fallback;
  const sortObj: Record<string, any> = {};
  const parts: string[] = String(sort).split(",").map((s: string) => s.trim()).filter(Boolean);
  
  for (const part of parts) {
    const desc = part.startsWith("-");
    const field = desc ? part.slice(1) : part;
    if (allowed.includes(field)) {
      sortObj[field] = desc ? -1 : 1;
    }
  }
  return Object.keys(sortObj).length ? sortObj : fallback;
};

// Run a paginated find on a Mongoose model and return { data, pagination }.
export const paginate = async (
  model: any,
  { filter = {}, page = 1, limit = 10, skip = 0, sort, populate, select, lean = true }: {
    filter?: Record<string, any>;
    page?: number;
    limit?: number;
    skip?: number;
    sort?: Record<string, any>;
    populate?: any;
    select?: any;
    lean?: boolean;
  } = {}
): Promise<{ data: any[]; pagination: { total: number; page: number; limit: number; totalPages: number; hasMore: boolean } }> => {
  let q: any = model.find(filter);
  if (sort) q = q.sort(sort);
  if (select) q = q.select(select);
  if (populate) {
    for (const p of ([] as any[]).concat(populate)) q = q.populate(p);
  }
  if (lean) q = q.lean();
  q = q.skip(skip).limit(limit);

  const [data, total] = await Promise.all([q, model.countDocuments(filter)]);

  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: skip + data.length < total,
    },
  };
};

// Cursor-based pagination (more efficient for large datasets)
export const paginateWithCursor = async (
  model: any,
  { filter = {}, limit = 10, sort = { _id: 1 }, cursor = null, direction = 'next', populate, select, lean = true }: {
    filter?: Record<string, any>;
    limit?: number;
    sort?: Record<string, any>;
    cursor?: string | null;
    direction?: string;
    populate?: any;
    select?: any;
    lean?: boolean;
  } = {}
): Promise<{ data: any[]; pagination: { total: null; limit: number; hasMore: boolean; nextCursor: string | null; prevCursor: string | null } }> => {
  let q: any = model.find(filter);
  if (sort) q = q.sort(sort);
  if (select) q = q.select(select);
  if (populate) {
    for (const p of ([] as any[]).concat(populate)) q = q.populate(p);
  }
  if (lean) q = q.lean();

  // Apply cursor
  if (cursor) {
    const cursorObj: any = JSON.parse(Buffer.from(cursor, 'base64').toString());
    if (direction === 'prev') {
      q = q.where('_id').lt(cursorObj._id);
    } else {
      q = q.where('_id').gt(cursorObj._id);
    }
  }

  // Fetch one extra to determine hasMore
  q = q.limit(limit + 1);
  const data: any[] = await q;

  const hasMore = data.length > limit;
  const items = hasMore ? data.slice(0, limit) : data;
  
  let nextCursor: string | null = null;
  let prevCursor: string | null = null;
  
  if (items.length) {
    const lastItem: any = items[items.length - 1];
    const firstItem: any = items[0];
    nextCursor = Buffer.from(JSON.stringify({ _id: lastItem._id })).toString('base64');
    prevCursor = Buffer.from(JSON.stringify({ _id: firstItem._id })).toString('base64');
  }

  return {
    data: items,
    pagination: {
      total: null, // Unknown in cursor pagination
      limit,
      hasMore,
      nextCursor,
      prevCursor,
    },
  };
};

// Build a comprehensive filter object combining all filter types
export const buildCompleteFilter = (query: any = {}, options: any = {}): Record<string, any> => {
  const {
    searchFields = [],
    searchOptions = {},
    equalityFields = [],
    advancedFilterOptions = {},
    rangeFields = {},
    dateRangeField = null,
    dateRangePresets = {},
  } = options;

  const filters: any[] = [];

  // Text search
  if (query.search) {
    filters.push(buildAdvancedSearch(query.search, searchFields, searchOptions));
  }

  // Equality filters
  if (equalityFields.length) {
    filters.push(buildFilters(query, equalityFields));
  }

  // Advanced equality filters (arrays, nested)
  if (Object.keys(advancedFilterOptions).length) {
    filters.push(buildAdvancedFilters(query, Object.keys(advancedFilterOptions), advancedFilterOptions));
  }

  // Range filters
  if (Object.keys(rangeFields).length) {
    filters.push(buildRangeFilters(query, rangeFields));
  }

  // Date range
  if (dateRangeField) {
    filters.push(buildDateRangeFilter(query, dateRangeField, dateRangePresets));
  }

  return filters.length ? { $and: filters } : {};
};

// Build a complete sort object
export const buildCompleteSort = (query: any = {}, options: any = {}): Record<string, any> => {
  const { sortFields = [], defaultSort = { createdAt: -1 } } = options;
  
  if (query.sort) {
    // Support multi-field sort: sort=-createdAt,title
    return parseMultiSort(query.sort, sortFields);
  }
  return { createdAt: -1 }; // Default
};

export default {
  parsePagination,
  parseCursorPagination,
  buildSearch,
  buildAdvancedSearch,
  buildFilters,
  buildAdvancedFilters,
  buildRangeFilters,
  buildDateRangeFilter,
  parseSort,
  parseMultiSort,
  paginate,
  paginateWithCursor,
  buildCompleteFilter,
  buildCompleteSort,
};
