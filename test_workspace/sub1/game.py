"""
Snake Game
A classic snake game built with Python's built-in tkinter GUI library.

Controls:
    Arrow Keys / WASD : Control the snake's direction
    Space             : Pause / Resume
    R                 : Restart after game over

Run with:
    python3 game.py
"""

import random
import tkinter as tk
from tkinter import messagebox


# Game constants
WINDOW_WIDTH = 600
WINDOW_HEIGHT = 400
GRID_SIZE = 20
GRID_WIDTH = WINDOW_WIDTH // GRID_SIZE
GRID_HEIGHT = WINDOW_HEIGHT // GRID_SIZE

SNAKE_COLOR = "#4ade80"      # green
FOOD_COLOR = "#f87171"       # red
BG_COLOR = "#111827"         # dark background
GRID_LINE_COLOR = "#1f2937"  # subtle grid lines
TEXT_COLOR = "#f3f4f6"       # light text

INITIAL_SPEED = 150  # milliseconds between moves
SPEED_INCREMENT = 2  # ms faster per food eaten
MIN_SPEED = 60       # fastest allowed speed

# Direction vectors (dx, dy)
DIRECTIONS = {
    "Up": (0, -1),
    "Down": (0, 1),
    "Left": (-1, 0),
    "Right": (1, 0),
}

# Keys that can start a new direction
KEY_MAP = {
    "Up": "Up",
    "Down": "Down",
    "Left": "Left",
    "Right": "Right",
    "w": "Up",
    "s": "Down",
    "a": "Left",
    "d": "Right",
    "W": "Up",
    "S": "Down",
    "A": "Left",
    "D": "Right",
}

OPPOSITES = {
    "Up": "Down",
    "Down": "Up",
    "Left": "Right",
    "Right": "Left",
}


class SnakeGame:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("贪吃蛇 Snake Game")
        self.root.resizable(False, False)

        # Build UI
        self.score_var = tk.StringVar(value="Score: 0")
        self._build_ui()

        # Bind input
        self.root.bind("<Key>", self._on_key_press)

        # Game state
        self.snake: list[tuple[int, int]] = []
        self.direction: str = "Right"
        self.next_direction: str = "Right"
        self.food: tuple[int, int] = (0, 0)
        self.score: int = 0
        self.running: bool = False
        self.paused: bool = False
        self.game_loop_id: str | None = None
        self.speed: int = INITIAL_SPEED

        self.start_game()

    def _build_ui(self) -> None:
        """Create the score label and game canvas."""
        self.score_label = tk.Label(
            self.root,
            textvariable=self.score_var,
            font=("Helvetica", 16, "bold"),
            bg=BG_COLOR,
            fg=TEXT_COLOR,
            pady=8,
        )
        self.score_label.pack(fill=tk.X)

        self.canvas = tk.Canvas(
            self.root,
            width=WINDOW_WIDTH,
            height=WINDOW_HEIGHT,
            bg=BG_COLOR,
            highlightthickness=0,
        )
        self.canvas.pack()

        self._draw_grid()

    def _draw_grid(self) -> None:
        """Draw subtle grid lines on the canvas."""
        for x in range(0, WINDOW_WIDTH, GRID_SIZE):
            self.canvas.create_line(
                x, 0, x, WINDOW_HEIGHT, fill=GRID_LINE_COLOR, tags="grid"
            )
        for y in range(0, WINDOW_HEIGHT, GRID_SIZE):
            self.canvas.create_line(
                0, y, WINDOW_WIDTH, y, fill=GRID_LINE_COLOR, tags="grid"
            )

    def start_game(self) -> None:
        """Initialize or reset the game state."""
        # Stop any existing loop
        self._cancel_loop()

        # Reset state
        start_x = GRID_WIDTH // 2
        start_y = GRID_HEIGHT // 2
        self.snake = [
            (start_x, start_y),
            (start_x - 1, start_y),
            (start_x - 2, start_y),
        ]
        self.direction = "Right"
        self.next_direction = "Right"
        self.score = 0
        self.speed = INITIAL_SPEED
        self.running = True
        self.paused = False

        self._update_score()
        self._place_food()
        self._draw()
        self._schedule_next_move()

    def _place_food(self) -> None:
        """Place food on a random empty grid cell."""
        while True:
            x = random.randint(0, GRID_WIDTH - 1)
            y = random.randint(0, GRID_HEIGHT - 1)
            if (x, y) not in self.snake:
                self.food = (x, y)
                break

    def _on_key_press(self, event: tk.Event) -> None:
        """Handle keyboard input."""
        key = event.keysym

        # Restart
        if key in ("r", "R") and not self.running:
            self.start_game()
            return

        # Pause / Resume
        if key == "space":
            if self.running:
                self.paused = not self.paused
                if not self.paused:
                    self._schedule_next_move()
            return

        # Change direction
        if key in KEY_MAP:
            new_dir = KEY_MAP[key]
            # Prevent reversing directly into the snake's own body
            if new_dir != OPPOSITES[self.direction]:
                self.next_direction = new_dir

    def _update_score(self) -> None:
        """Update the score label."""
        self.score_var.set(f"Score: {self.score}")

    def _schedule_next_move(self) -> None:
        """Schedule the next game tick."""
        self.game_loop_id = self.root.after(self.speed, self._game_tick)

    def _cancel_loop(self) -> None:
        """Cancel any pending game loop."""
        if self.game_loop_id is not None:
            self.root.after_cancel(self.game_loop_id)
            self.game_loop_id = None

    def _game_tick(self) -> None:
        """Update game state and redraw."""
        if not self.running or self.paused:
            return

        # Apply queued direction change
        self.direction = self.next_direction
        dx, dy = DIRECTIONS[self.direction]

        head_x, head_y = self.snake[0]
        new_head = (head_x + dx, head_y + dy)

        # Check wall collision
        if not (0 <= new_head[0] < GRID_WIDTH and 0 <= new_head[1] < GRID_HEIGHT):
            self._game_over()
            return

        # Check self collision
        if new_head in self.snake:
            self._game_over()
            return

        # Move snake
        self.snake.insert(0, new_head)

        # Check food
        if new_head == self.food:
            self.score += 10
            self._update_score()
            self._place_food()
            # Speed up slightly, capped at MIN_SPEED
            self.speed = max(MIN_SPEED, self.speed - SPEED_INCREMENT)
        else:
            self.snake.pop()

        self._draw()
        self._schedule_next_move()

    def _draw(self) -> None:
        """Render all game objects on the canvas."""
        self.canvas.delete("snake", "food", "gameover")

        # Draw food
        fx, fy = self.food
        self.canvas.create_oval(
            fx * GRID_SIZE + 2,
            fy * GRID_SIZE + 2,
            (fx + 1) * GRID_SIZE - 2,
            (fy + 1) * GRID_SIZE - 2,
            fill=FOOD_COLOR,
            outline="",
            tags="food",
        )

        # Draw snake
        for i, (x, y) in enumerate(self.snake):
            color = "#22c55e" if i == 0 else SNAKE_COLOR
            self.canvas.create_rectangle(
                x * GRID_SIZE + 1,
                y * GRID_SIZE + 1,
                (x + 1) * GRID_SIZE - 1,
                (y + 1) * GRID_SIZE - 1,
                fill=color,
                outline=BG_COLOR,
                tags="snake",
            )

        # Draw pause overlay
        if self.paused:
            self.canvas.create_text(
                WINDOW_WIDTH // 2,
                WINDOW_HEIGHT // 2,
                text="PAUSED\nPress SPACE to resume",
                fill=TEXT_COLOR,
                font=("Helvetica", 20, "bold"),
                justify=tk.CENTER,
                tags="gameover",
            )

    def _game_over(self) -> None:
        """Handle game over state."""
        self.running = False
        self._cancel_loop()

        self.canvas.create_text(
            WINDOW_WIDTH // 2,
            WINDOW_HEIGHT // 2 - 20,
            text="GAME OVER",
            fill=FOOD_COLOR,
            font=("Helvetica", 28, "bold"),
            tags="gameover",
        )
        self.canvas.create_text(
            WINDOW_WIDTH // 2,
            WINDOW_HEIGHT // 2 + 20,
            text=f"Final Score: {self.score}\nPress R to restart",
            fill=TEXT_COLOR,
            font=("Helvetica", 14),
            justify=tk.CENTER,
            tags="gameover",
        )


def main() -> None:
    root = tk.Tk()
    game = SnakeGame(root)
    root.mainloop()


if __name__ == "__main__":
    main()
