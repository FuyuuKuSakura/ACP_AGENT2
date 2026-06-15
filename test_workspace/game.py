"""贪吃蛇游戏核心逻辑。

使用 Python 标准库 tkinter 实现，包含：
- 方向键控制蛇的移动
- 随机生成食物
- 碰撞检测（墙壁和自身）
- 得分与速度递增
- 空格键暂停/继续
- R 键重新开始
"""

import random
import tkinter as tk
from tkinter import messagebox


class SnakeGame:
    """贪吃蛇游戏主类。"""

    # 画布与网格配置
    CELL_SIZE = 20
    GRID_WIDTH = 30
    GRID_HEIGHT = 20
    WIDTH = CELL_SIZE * GRID_WIDTH
    HEIGHT = CELL_SIZE * GRID_HEIGHT

    # 颜色
    BG_COLOR = "#1e1e1e"
    SNAKE_HEAD_COLOR = "#4ade80"
    SNAKE_BODY_COLOR = "#22c55e"
    FOOD_COLOR = "#ef4444"
    TEXT_COLOR = "#ffffff"
    GRID_LINE_COLOR = "#2a2a2a"

    # 初始速度（毫秒）
    INITIAL_SPEED = 150
    MIN_SPEED = 60
    SPEED_STEP = 5

    # 方向向量 (dx, dy)
    DIRECTIONS = {
        "Up": (0, -1),
        "Down": (0, 1),
        "Left": (-1, 0),
        "Right": (1, 0),
    }

    # 与每个方向相反的方向
    OPPOSITES = {
        "Up": "Down",
        "Down": "Up",
        "Left": "Right",
        "Right": "Left",
    }

    def __init__(self, master: tk.Tk):
        self.master = master
        self.master.title("贪吃蛇 Snake")
        self.master.resizable(False, False)

        # 顶部信息栏
        self.info_frame = tk.Frame(self.master, bg=self.BG_COLOR)
        self.info_frame.pack(fill=tk.X)
        self.score_label = tk.Label(
            self.info_frame,
            text="得分: 0",
            font=("Helvetica", 14),
            bg=self.BG_COLOR,
            fg=self.TEXT_COLOR,
        )
        self.score_label.pack(side=tk.LEFT, padx=10, pady=5)
        self.status_label = tk.Label(
            self.info_frame,
            text="按方向键开始",
            font=("Helvetica", 12),
            bg=self.BG_COLOR,
            fg=self.TEXT_COLOR,
        )
        self.status_label.pack(side=tk.RIGHT, padx=10, pady=5)

        # 游戏画布
        self.canvas = tk.Canvas(
            self.master,
            width=self.WIDTH,
            height=self.HEIGHT,
            bg=self.BG_COLOR,
            highlightthickness=0,
        )
        self.canvas.pack()

        # 绑定键盘事件
        self.master.bind("<Key>", self._on_key_press)
        self.master.bind("<space>", self._toggle_pause)
        self.master.bind("<r>", self._restart)
        self.master.bind("<R>", self._restart)

        # 初始化游戏状态
        self._reset_state()
        self._draw_grid()
        self._show_start_prompt()

    def _reset_state(self):
        """重置游戏状态变量。"""
        # 蛇身，头部在列表末尾
        start_x = self.GRID_WIDTH // 2
        start_y = self.GRID_HEIGHT // 2
        self.snake = [
            (start_x - 2, start_y),
            (start_x - 1, start_y),
            (start_x, start_y),
        ]

        self.direction = "Right"
        self.next_direction = "Right"
        self.score = 0
        self.speed = self.INITIAL_SPEED
        self.running = False
        self.paused = False
        self.game_over = False
        self.food = None
        self.items = {}  # (x, y) -> canvas id
        self._scheduled_id = None

    def _draw_grid(self):
        """绘制背景网格线。"""
        for i in range(0, self.WIDTH, self.CELL_SIZE):
            self.canvas.create_line(
                i, 0, i, self.HEIGHT, fill=self.GRID_LINE_COLOR, tags="grid"
            )
        for j in range(0, self.HEIGHT, self.CELL_SIZE):
            self.canvas.create_line(
                0, j, self.WIDTH, j, fill=self.GRID_LINE_COLOR, tags="grid"
            )

    def _show_start_prompt(self):
        """显示开始提示。"""
        self.canvas.create_text(
            self.WIDTH // 2,
            self.HEIGHT // 2 - 20,
            text="贪吃蛇",
            font=("Helvetica", 32, "bold"),
            fill=self.TEXT_COLOR,
            tags="prompt",
        )
        self.canvas.create_text(
            self.WIDTH // 2,
            self.HEIGHT // 2 + 25,
            text="按方向键开始游戏",
            font=("Helvetica", 14),
            fill=self.TEXT_COLOR,
            tags="prompt",
        )

    def _start_game(self):
        """开始新游戏。"""
        if self.running:
            return
        self._reset_state()
        self.canvas.delete("prompt")
        self.canvas.delete("gameover")
        self.running = True
        self._create_food()
        self._draw_all()
        self._update_status("游戏中")
        self._schedule_next_move()

    def _create_food(self):
        """在蛇身之外随机生成食物。"""
        while True:
            x = random.randint(0, self.GRID_WIDTH - 1)
            y = random.randint(0, self.GRID_HEIGHT - 1)
            if (x, y) not in self.snake:
                self.food = (x, y)
                return

    def _draw_all(self):
        """重新绘制蛇和食物。"""
        # 清除旧的动态对象
        self.canvas.delete("snake")
        self.canvas.delete("food")

        # 绘制蛇
        for index, (x, y) in enumerate(self.snake):
            color = self.SNAKE_HEAD_COLOR if index == len(self.snake) - 1 else self.SNAKE_BODY_COLOR
            self._draw_cell(x, y, color, tags="snake")

        # 绘制食物
        if self.food:
            self._draw_cell(self.food[0], self.food[1], self.FOOD_COLOR, tags="food")

    def _draw_cell(self, x: int, y: int, color: str, tags: str = ""):
        """在指定网格位置绘制一个带圆角的方块。"""
        margin = 1
        x1 = x * self.CELL_SIZE + margin
        y1 = y * self.CELL_SIZE + margin
        x2 = (x + 1) * self.CELL_SIZE - margin
        y2 = (y + 1) * self.CELL_SIZE - margin
        self.canvas.create_rectangle(
            x1, y1, x2, y2, fill=color, outline="", tags=tags
        )

    def _on_key_press(self, event: tk.Event):
        """处理方向键输入。"""
        key = event.keysym
        if key not in self.DIRECTIONS:
            return

        # 第一次按方向键时开始游戏
        if not self.running and not self.game_over:
            # 起始方向设为按键方向
            self.next_direction = key
            self.direction = key
            self._start_game()
            return

        if self.game_over or self.paused:
            return

        # 防止直接反向移动
        if key != self.OPPOSITES[self.direction]:
            self.next_direction = key

    def _toggle_pause(self, event: tk.Event = None):
        """切换暂停状态。"""
        if not self.running or self.game_over:
            return
        self.paused = not self.paused
        if self.paused:
            self._update_status("已暂停 - 按空格继续")
            if self._scheduled_id:
                self.master.after_cancel(self._scheduled_id)
                self._scheduled_id = None
        else:
            self._update_status("游戏中")
            self._schedule_next_move()

    def _restart(self, event: tk.Event = None):
        """重新开始游戏。"""
        if self._scheduled_id:
            self.master.after_cancel(self._scheduled_id)
            self._scheduled_id = None
        self.canvas.delete("snake")
        self.canvas.delete("food")
        self.canvas.delete("gameover")
        self.canvas.delete("prompt")
        self._reset_state()
        self._show_start_prompt()
        self.score_label.config(text="得分: 0")
        self.status_label.config(text="按方向键开始")

    def _schedule_next_move(self):
        """安排下一次移动。"""
        self._scheduled_id = self.master.after(self.speed, self._move)

    def _move(self):
        """执行一次蛇的移动。"""
        if not self.running or self.paused or self.game_over:
            return

        self.direction = self.next_direction
        dx, dy = self.DIRECTIONS[self.direction]
        head_x, head_y = self.snake[-1]
        new_head = (head_x + dx, head_y + dy)

        # 撞墙检测
        if not (0 <= new_head[0] < self.GRID_WIDTH and 0 <= new_head[1] < self.GRID_HEIGHT):
            self._game_over()
            return

        # 撞到自身检测
        if new_head in self.snake:
            self._game_over()
            return

        self.snake.append(new_head)

        # 吃到食物
        if new_head == self.food:
            self.score += 10
            self.score_label.config(text=f"得分: {self.score}")
            # 稍微加快速度
            self.speed = max(self.MIN_SPEED, self.speed - self.SPEED_STEP)
            self._create_food()
        else:
            self.snake.pop(0)

        self._draw_all()
        self._schedule_next_move()

    def _game_over(self):
        """处理游戏结束。"""
        self.game_over = True
        self.running = False
        if self._scheduled_id:
            self.master.after_cancel(self._scheduled_id)
            self._scheduled_id = None
        self._update_status("游戏结束")

        self.canvas.create_text(
            self.WIDTH // 2,
            self.HEIGHT // 2 - 20,
            text="游戏结束",
            font=("Helvetica", 32, "bold"),
            fill=self.FOOD_COLOR,
            tags="gameover",
        )
        self.canvas.create_text(
            self.WIDTH // 2,
            self.HEIGHT // 2 + 25,
            text=f"最终得分: {self.score}    按 R 重新开始",
            font=("Helvetica", 14),
            fill=self.TEXT_COLOR,
            tags="gameover",
        )

    def _update_status(self, text: str):
        """更新状态标签。"""
        self.status_label.config(text=text)

    def run(self):
        """启动主循环。"""
        self.master.mainloop()
