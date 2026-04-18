import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSessionQueryKey } from "@workspace/api-client-react";

export function useSessionSocket(sessionCode: string | undefined, onEvent?: (event: string) => void) {
  const socketRef = useRef<Socket | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!sessionCode) return;

    const socket = io({ path: "/api/socket.io" });
    socketRef.current = socket;

    socket.emit("join:session", sessionCode);

    const handleUpdate = () => {
      queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionCode) });
    };

    socket.on("selection:updated", () => {
      handleUpdate();
      onEvent?.("selection:updated");
    });
    
    socket.on("participant:joined", () => {
      handleUpdate();
      onEvent?.("participant:joined");
    });
    
    socket.on("participant:submitted", () => {
      handleUpdate();
      onEvent?.("participant:submitted");
    });

    socket.on("session:finalized", () => {
      handleUpdate();
      onEvent?.("session:finalized");
    });

    socket.on("session:started", () => {
      handleUpdate();
      onEvent?.("session:started");
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [sessionCode, queryClient, onEvent]);

  return socketRef;
}
