#include <stdio.h>

void bubbleSort(int x[], int len) {
    int i, j, t;
    for (i = 0; i < len - 1; i++) {
        for (j = 0; j < len - 1 - i; j++) {
            if (x[j] > x[j + 1]) {
                t = x[j];
                x[j] = x[j + 1];
                x[j + 1] = t;
            }
        }
    }
}

int main() {
    int num, original[100], sorted[100];
    int i, s = 0, e = 0, palin = 1;
    scanf("%d", &num);
    for (i = 0; i < num; i++) {
        scanf("%d", &original[i]);
        sorted[i] = original[i];
        s = s + original[i];
        if (original[i] % 2 == 0) e++;
    }
    bubbleSort(sorted, num);
    printf("Sum: %d\n", s);
    printf("Average: %.2f\n", (float)s / num);
    printf("Max: %d\n", sorted[num - 1]);
    printf("Min: %d\n", sorted[0]);
    int k = num - 2;
    while (k >= 0 && sorted[k] == sorted[num - 1]) k--;
    if (k >= 0) printf("Second largest: %d\n", sorted[k]);
    else printf("Second largest: none\n");
    printf("Even: %d Odd: %d\n", e, num - e);
    printf("Reversed:");
    for (i = num - 1; i >= 0; i--) printf(" %d", original[i]);
    printf("\n");
    for (i = 0; i < num; i++) {
        if (original[i] != original[num - i - 1]) {
            palin = 0;
            break;
        }
    }
    printf("Palindrome: %s\n", palin == 1 ? "Yes" : "No");
    return 0;
}
