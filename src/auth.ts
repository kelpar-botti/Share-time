import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  trustHost: true,
  pages: {
    signIn: "/admin/login",
  },
  callbacks: {
    async signIn({ user }) {
      return !!user.email && user.email === process.env.ADMIN_EMAIL;
    },
  },
});
