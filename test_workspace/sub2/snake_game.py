import tkinter as tk
import random

# 游戏配置
WINDOW_WIDTH = 600
WINDOW_HEIGHT = 400
GRID_SIZE = 20
GRID_WIDTH = WINDOW_WIDTH // GRID_SIZE
GRID_HEIGHT = WINDOW_HEIGHT // GRID_SIZE
SPEED = 150  # 毫秒

class SnakeGame:
    def __init__(self, master):
        self.master = master
        self.master.title("贪吃蛇小游戏")
        self.master.resizable(False, False)

        # 分数标签
        self.score = 0
        self.score_label = tk.Label(
            master,
            text=f"得分: {self.score}",
            font=("Arial", 16)
        )
        self.score_label.pack()

        # 游戏画布
        self.canvas = tk.Canvas(
            master,
            width=WINDOW_WIDTH,
            height=WINDOW_HEIGHT,
            bg="black",
            highlightthickness=0
        )
        self.canvas.pack()

        # 游戏状态
        self.snake = [(5, 5), (4, 5), (3, 5)]
        self.direction = (1, 0)
        self.next_direction = (1, 0)
        self.food = self.spawn_food()
        self.game_over = False

        # 绑定按键
        self.master.bind("<Key>", self.on_key_press)
        self.master.bind("<Return>", self.restart_game)

        # 开始游戏循环
        self.update()

    def spawn_food(self):
        while True:
            pos = (random.randint(0, GRID_WIDTH - 1), random.randint(0, GRID_HEIGHT - 1))
            if pos not in self.snake:
                return pos

    def on_key_press(self, event):
        key = event.keysym
        # 防止反方向移动
        if key == "Up" and self.direction != (0, 1):
            self.next_direction = (0, -1)
        elif key == "Down" and self.direction != (0, -1):
            self.next_direction = (0, 1)
        elif key == "Left" and self.direction != (1, 0):
            self.next_direction = (-1, 0)
        elif key == "Right" and self.direction != (-1, 0):
            self.next_direction = (1, 0)

    def restart_game(self, event=None):
        if self.game_over:
            self.snake = [(5, 5), (4, 5), (3, 5)]
            self.direction = (1, 0)
            self.next_direction = (1, 0)
            self.food = self.spawn_food()
            self.score = 0
            self.score_label.config(text=f"得分: {self.score}")
            self.game_over = False
            self.update()

    def update(self):
        if self.game_over:
            return

        self.direction = self.next_direction

        # 新头部位置
        head_x, head_y = self.snake[0]
        new_head = (head_x + self.direction[0], head_y + self.direction[1])

        # 碰撞检测：墙壁或自身
        if (
            new_head[0] < 0 or new_head[0] >= GRID_WIDTH or
            new_head[1] < 0 or new_head[1] >= GRID_HEIGHT or
            new_head in self.snake
        ):
            self.end_game()
            return

        self.snake.insert(0, new_head)

        # 吃到食物
        if new_head == self.food:
            self.score += 10
            self.score_label.config(text=f"得分: {self.score}")
            self.food = self.spawn_food()
        else:
            self.snake.pop()

        self.draw()
        self.master.after(SPEED, self.update)

    def draw(self):
        self.canvas.delete("all")

        # 画食物
        fx, fy = self.food
        self.canvas.create_oval(
            fx * GRID_SIZE + 2, fy * GRID_SIZE + 2,
            (fx + 1) * GRID_SIZE - 2, (fy + 1) * GRID_SIZE - 2,
            fill="red", outline=""
        )

        # 画蛇
        for i, (x, y) in enumerate(self.snake):
            color = "lime" if i == 0 else "green"
            self.canvas.create_rectangle(
                x * GRID_SIZE, y * GRID_SIZE,
                (x + 1) * GRID_SIZE, (y + 1) * GRID_SIZE,
                fill=color, outline="black"
            )

    def end_game(self):
        self.game_over = True
        self.canvas.create_text(
            WINDOW_WIDTH // 2, WINDOW_HEIGHT // 2 - 20,
            text="游戏结束！",
            fill="white", font=("Arial", 32)
        )
        self.canvas.create_text(
            WINDOW_WIDTH // 2, WINDOW_HEIGHT // 2 + 20,
            text=f"最终得分: {self.score}",
            fill="white", font=("Arial", 20)
        )
        self.canvas.create_text(
            WINDOW_WIDTH // 2, WINDOW_HEIGHT // 2 + 55,
            text="按回车键重新开始",
            fill="yellow", font=("Arial", 14)
        )


def main():
    root = tk.Tk()
    game = SnakeGame(root)
    root.mainloop()


if __name__ == "__main__":
    main()
