declare global {
  namespace Express {
    interface Request {
      user?: any;
      orgAdminRole?: string;
    }
  }
}

export {};
