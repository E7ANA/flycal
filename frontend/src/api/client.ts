import axios from "axios";
import toast from "react-hot-toast";

const api = axios.create({
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Global error interceptor for network errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error.response) {
      toast.error("שגיאת רשת — בדוק שהשרת פועל");
    }
    return Promise.reject(error);
  },
);

export default api;
