"""贪吃蛇游戏入口。

运行方式:
    python main.py
"""

import tkinter as tk

from game import SnakeGame


def main():
    root = tk.Tk()
    game = SnakeGame(root)
    game.run()


if __name__ == "__main__":
    main()
