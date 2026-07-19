import "next-auth";

declare module "next-auth" {
  interface User {
    username: string;
    role: string;
    roleName: string;
    roleNameEn: string | null;
    permissions: string[];
  }

  interface Session {
    user: {
      id: number;
      name: string;
      username: string;
      role: string;
      roleName: string;
      roleNameEn: string | null;
      permissions: string[];
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: number;
    username: string;
    role: string;
    roleName: string;
    roleNameEn: string | null;
    permissions: string[];
  }
}
