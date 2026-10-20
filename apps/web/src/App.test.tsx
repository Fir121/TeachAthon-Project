import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { test, expect } from "vitest";
import { Auth } from "./App";
test("signup exposes role and accessible account fields", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText("New here? Create an account"));
  expect(screen.getByLabelText("I am a")).toHaveValue("student");
  expect(screen.getByLabelText("Password")).toHaveAttribute("minlength", "10");
});
